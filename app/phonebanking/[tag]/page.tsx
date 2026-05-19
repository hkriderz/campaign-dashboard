import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getTagById, resolveSurveyScriptProfile, tagUsesVerbatimFinalResultAggregate } from "@/lib/campaign-tags";
import { getDashboardAggregateLexicon } from "@/lib/dashboard-aggregate-lexicon";
import {
  fetchPhoneBanksByTag,
  fetchTagCallSurveyRowsForFinalFill,
  fetchTagDailyCallerStats,
  fetchTagPhonebankerQuestionStats,
} from "@/lib/queries/phonebanking";
import { getTombstonedSliceKeys, listTombstoneEntries } from "@/lib/csv-slice-tombstones";
import { getCsvSliceKeys, loadCsvData, getCsvUploadedAt } from "@/lib/csv-store";
import { appendCsvOnlyQuestionRowsForPbDashboard, getSyntheticPivotAllowlistFromWideHeaders } from "@/lib/csv-slice-question-synthesis";
import { loadExtraWideColumnOrder } from "@/lib/stw-extra-wide-column-order-store";
import { loadWideHeaderFieldMap } from "@/lib/stw-wide-header-field-map-store";
import { loadWideReferenceHeaders } from "@/lib/stw-wide-reference-store";
import { runServerWithCredentialContext } from "@/lib/credentials";
import PhoneBankTable from "@/components/phonebanking/PhoneBankTable";
import ErrorBanner from "@/components/shared/ErrorBanner";
import TabBar from "@/components/phonebanking/TabBar";
import PhonebankerAggregateTable from "@/components/phonebanking/PhonebankerAggregateTable";
import DailyAggregateSection from "@/components/phonebanking/DailyAggregateSection";
import BqSnapshotRefreshPanel from "@/components/phonebanking/BqSnapshotRefreshPanel";
import TagDataRefreshBar from "@/components/phonebanking/TagDataRefreshBar";
import PbDashboardStack, {
  type PbDashboardSlice,
  type PbQuestionAnswerRow,
} from "@/components/phonebanking/PbDashboardStack";
import TombstoneOverlapAfterRefresh from "@/components/phonebanking/TombstoneOverlapAfterRefresh";
import TagHiddenSlicesBar, { type HiddenSliceRow } from "@/components/phonebanking/TagHiddenSlicesBar";
import { makeSliceKey, normalizeCampaignKey, normalizeDateToIso } from "@/lib/slice-key";
import {
  buildPhonebankerRepMapBySlice,
  mergePhonebankerQuestionStats,
  mergeTagDailyCallerStats,
  resolvePhonebankerRep,
} from "@/lib/phonebanker-dedupe";
import { canonicalizePhonebankerKey, canonicalizePhonebankerName } from "@/lib/phonebanker-name";
import {
  EMPTY_CSV_ROW,
  type CallSurveyRowForFill,
  type PhoneBankSummary,
  type PhoneBankCsvRow,
  type TagDailyCallerStat,
  type PhonebankerQuestionResponseStat,
} from "@/lib/types";
import { normalizeName, parseTimeToSec, secToTime, sumRows } from "@/lib/csv-parser";
import { rollupPollingAndFinalAnswers } from "@/lib/daily-aggregate-survey-rollup";
import type { AggregateScopeQuestionRow } from "@/lib/daily-aggregate-question-rollups";
import { aggregateFilledFinalResults } from "@/lib/final-result-fill-aggregate";
import { consolidateSurveyAnswerLines } from "@/lib/survey-answer-consolidation";
import { mergeTraciViolationStatsFromBq } from "@/lib/traci-violation-bq";
import { withInferredContactMetrics } from "@/lib/infer-csv-contact-metrics";
import { snapshotsDisabled } from "@/lib/bq-snapshot-store";
import { getTagDashboardSnapshotMeta } from "@/lib/tag-dashboard-snapshot";
import {
  buildPhonebankerBqOutcomeMap,
  mergePhoneBankRowWithBqOutcomes,
} from "@/lib/phonebanker-bq-outcomes";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ tab?: string; date?: string | string[] }>;
};

function firstSearchParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.trim() : "";
}

/** Normalize `date` query to YYYY-MM-DD so it matches BQ/CSV slice dates. */
function normalizeSelectedDateParam(raw: string): string {
  const head = raw.trim().slice(0, 32);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  const fromUs = normalizeDateToIso(head);
  return fromUs ?? "";
}

const TABS = [
  { id: "overview", label: "All Phonebanks", icon: "📊" },
  { id: "aggregate", label: "By Phone Bank", icon: "📋" },
  { id: "phonebankers", label: "Phonebankers", icon: "👥" },
  { id: "csv", label: "CSV Upload", icon: "📤" },
];

function fmtHours(h: number) {
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(h * 60)}m`;
}

function countUniquePhonebankersForSliceKeys(
  rows: TagDailyCallerStat[],
  sliceKeys: ReadonlySet<string>
): number {
  const names = new Set<string>();
  for (const r of rows) {
    const sk = makeSliceKey(r.campaignName, r.callDate);
    if (!sliceKeys.has(sk)) continue;
    names.add(canonicalizePhonebankerName(r.phonebankerName));
  }
  return names.size;
}

/**
 * When a date is selected, the BQ phone-bank rollup can omit campaigns that still have daily-caller
 * slices. Build one row per visible slice from caller metrics (same grain as the aggregate).
 */
function buildOverviewPhoneBankRowsForSelectedDate(
  filteredSlices: PbDashboardSlice[],
  callerMetricsBySlice: Record<string, TagDailyCallerStat[]>,
  phoneBanksByCampaignKey: Map<string, PhoneBankSummary>,
  isoDate: string
): PhoneBankSummary[] {
  const out: PhoneBankSummary[] = [];
  for (const slice of filteredSlices) {
    const ck = normalizeCampaignKey(slice.campaignName);
    const base = phoneBanksByCampaignKey.get(ck);
    const dm = callerMetricsBySlice[slice.sliceKey] ?? [];
    let totalDials = 0;
    let totalSeconds = 0;
    const bankerNames = new Set<string>();
    let campaignId = base?.campaignId ?? "";
    for (const r of dm) {
      totalDials += r.numDials;
      totalSeconds += r.totalCallSeconds;
      bankerNames.add(canonicalizePhonebankerName(r.phonebankerName));
      if (!campaignId && r.campaignId) campaignId = r.campaignId;
    }
    let uniqueCallers = bankerNames.size;
    if (dm.length === 0) {
      totalDials = slice.numDials;
      totalSeconds = slice.callSeconds;
      uniqueCallers = slice.pbers;
    }
    out.push({
      campaignId,
      campaignName: slice.campaignName,
      totalDials,
      uniqueCallers,
      totalHours: Math.round((totalSeconds / 3600) * 100) / 100,
      totalSeconds,
      firstCallDate: isoDate,
      lastCallDate: isoDate,
      campaignCreatedDate: base?.campaignCreatedDate ?? "",
    });
  }
  return out.sort(
    (a, b) => b.totalDials - a.totalDials || a.campaignName.localeCompare(b.campaignName)
  );
}

function blankCsvRow(): PhoneBankCsvRow {
  return {
    ...EMPTY_CSV_ROW,
    date: "",
    phoneBankName: "",
    callerName: "",
    callerNameRaw: "",
    hoursLoggedIn: "0:00:00",
    timeInCalls: "0:00:00",
    surveyRateRaw: "",
  };
}

export default async function TagPage({ params, searchParams }: Props) {
  return runServerWithCredentialContext(async () => {
  const { tag: tagId } = await params;
  const sp = await searchParams;
  const { tab = "overview", date: dateRaw } = sp;
  const selectedDate = normalizeSelectedDateParam(firstSearchParam(dateRaw));

  const tag = getTagById(tagId);
  if (!tag) notFound();

  const surveyScriptProfile = resolveSurveyScriptProfile(tag);
  const verbatimFinalResult = tagUsesVerbatimFinalResultAggregate(tag);
  const aggregateLexicon = getDashboardAggregateLexicon(tag, surveyScriptProfile);

  const snapshotMode = !snapshotsDisabled();

  // Load BigQuery data
  let phoneBanks: PhoneBankSummary[] = [];
  let bqDailyCaller: TagDailyCallerStat[] = [];
  let bqQuestionStats: PhonebankerQuestionResponseStat[] = [];
  let bqCallSurveyForFill: CallSurveyRowForFill[] = [];
  let bqError: string | null = null;
  try {
    const fillPromise = tag.useCallLevelFinalResultFill
      ? fetchTagCallSurveyRowsForFinalFill(tagId)
      : Promise.resolve([] as CallSurveyRowForFill[]);
    [phoneBanks, bqDailyCaller, bqQuestionStats, bqCallSurveyForFill] = await Promise.all([
      fetchPhoneBanksByTag(tagId),
      fetchTagDailyCallerStats(tagId),
      fetchTagPhonebankerQuestionStats(tagId),
      fillPromise,
    ]);
  } catch (err) {
    bqError = err instanceof Error ? err.message : String(err);
  }

  const snapshotMeta = getTagDashboardSnapshotMeta(tagId);

  // Load CSV data (server-side, from /data/ directory)
  const csvUploadedAt = getCsvUploadedAt(tagId);
  const csvSliceKeysForPbDashboard = Array.from(getCsvSliceKeys(tagId));
  const csvRowsSafe = (loadCsvData(tagId) ?? []).map(withInferredContactMetrics);
  const wideExtraColumnOrder = loadExtraWideColumnOrder(tagId);
  const wideRefHeaders = loadWideReferenceHeaders(tagId) ?? [];
  const wideHeaderFieldMap = loadWideHeaderFieldMap(tagId);
  const syntheticPivotAllowlistByQuestion: Record<string, string[]> | undefined =
    wideRefHeaders.length > 0
      ? Object.fromEntries(
          [...getSyntheticPivotAllowlistFromWideHeaders(wideRefHeaders, wideHeaderFieldMap)].map(([q, set]) => [
            q,
            [...set],
          ])
        )
      : undefined;

  /** Merge likely-duplicate dialer names per campaign day (e.g. "Car5" vs "Carmen Acosta"). */
  const phonebankerRepBySlice = buildPhonebankerRepMapBySlice(bqDailyCaller, csvRowsSafe);
  bqDailyCaller = mergeTagDailyCallerStats(
    bqDailyCaller.map((r) => ({
      ...r,
      phonebankerName: resolvePhonebankerRep(
        phonebankerRepBySlice,
        r.campaignName,
        r.callDate,
        r.phonebankerName
      ),
    }))
  );
  bqQuestionStats = mergePhonebankerQuestionStats(
    bqQuestionStats.map((r) => ({
      ...r,
      phonebankerName: resolvePhonebankerRep(
        phonebankerRepBySlice,
        r.campaignName,
        r.callDate,
        r.phonebankerName
      ),
    }))
  );

  if (bqCallSurveyForFill.length > 0) {
    bqCallSurveyForFill = bqCallSurveyForFill.map((r) => ({
      ...r,
      phonebankerName: resolvePhonebankerRep(
        phonebankerRepBySlice,
        r.campaignName,
        r.callDate,
        r.phonebankerName
      ),
    }));
  }

  const bqSliceMap = new Map<string, PbDashboardSlice>();
  const bqSliceKeys = new Set<string>();
  for (const row of bqDailyCaller) {
    const sliceKey = makeSliceKey(row.campaignName, row.callDate);
    bqSliceKeys.add(sliceKey);
    if (!bqSliceMap.has(sliceKey)) {
      bqSliceMap.set(sliceKey, {
        sliceKey,
        campaignName: row.campaignName,
        callDate: row.callDate,
        numDials: 0,
        pbers: 0,
        callsAnswered: 0,
        talkingToCorrectPerson: 0,
        loggedInSeconds: 0,
        callSeconds: 0,
        surveyed: 0,
        pollingFaizah: 0,
        pollingAntiTraci: 0,
        pollingUndecided: 0,
        pollingTraci: 0,
        traciSurveyed: 0,
        traciYes: 0,
        traciUnsure: 0,
        traciNo: 0,
        finalTotal: 0,
        finalSS: 0,
        finalAntiTraci: 0,
        finalUndecided: 0,
        finalSO: 0,
        finalSupport: 0,
        finalOppose: 0,
        canvassTotal: 0,
      });
    }
    const agg = bqSliceMap.get(sliceKey)!;
    agg.numDials += row.numDials;
    agg.pbers += 1;
    agg.callsAnswered += row.callsAnswered;
    agg.talkingToCorrectPerson += row.talkingToCorrectPerson;
    agg.loggedInSeconds += row.totalDialerSeconds;
    agg.callSeconds += row.totalCallSeconds;
    agg.surveyed += row.surveyed;
  }

  const tombEntries = listTombstoneEntries(tagId);
  const tombstonedSliceKeys = getTombstonedSliceKeys(tagId);
  const hiddenSlicesForRestore: HiddenSliceRow[] = tombEntries.map((t) => ({
    sliceKey: t.sliceKey,
    phoneBankName: t.phoneBankName,
    isoDate: t.isoDate,
    reason: t.reason,
    inBqSnapshot: bqSliceKeys.has(t.sliceKey),
  }));

  const csvRowsBySliceCaller = new Map<string, PhoneBankCsvRow[]>();
  /** Unique callers per slice for CSV-only slices (BQ has its own pber counts). */
  const csvOnlyCallerKeysBySlice = new Map<string, Set<string>>();
  for (const row of csvRowsSafe) {
    const isoDate = normalizeDateToIso(row.date);
    if (!isoDate) continue;
    const canonicalCaller = resolvePhonebankerRep(
      phonebankerRepBySlice,
      row.phoneBankName,
      isoDate,
      normalizeName(row.callerName)
    );
    const key = `${normalizeCampaignKey(row.phoneBankName)}|${isoDate}|${canonicalizePhonebankerKey(canonicalCaller)}`;
    const existing = csvRowsBySliceCaller.get(key) ?? [];
    existing.push({
      ...row,
      callerName: canonicalCaller,
      callerNameRaw: row.callerNameRaw || row.callerName,
    });
    csvRowsBySliceCaller.set(key, existing);

    const sliceKey = makeSliceKey(row.phoneBankName, isoDate);
    if (!bqSliceMap.has(sliceKey)) {
      bqSliceMap.set(sliceKey, {
        sliceKey,
        campaignName: row.phoneBankName,
        callDate: isoDate,
        numDials: 0,
        pbers: 0,
        callsAnswered: 0,
        talkingToCorrectPerson: 0,
        loggedInSeconds: 0,
        callSeconds: 0,
        surveyed: 0,
        pollingFaizah: 0,
        pollingAntiTraci: 0,
        pollingUndecided: 0,
        pollingTraci: 0,
        traciSurveyed: 0,
        traciYes: 0,
        traciUnsure: 0,
        traciNo: 0,
        finalTotal: 0,
        finalSS: 0,
        finalAntiTraci: 0,
        finalUndecided: 0,
        finalSO: 0,
        finalSupport: 0,
        finalOppose: 0,
        canvassTotal: 0,
      });
    }
    const agg = bqSliceMap.get(sliceKey)!;
    if (!bqSliceKeys.has(sliceKey)) {
      agg.surveyed += row.surveyed;
      agg.callsAnswered += row.callsAnswered;
      agg.talkingToCorrectPerson += row.correctPerson;
      agg.loggedInSeconds += parseTimeToSec(row.hoursLoggedIn);
      agg.callSeconds += parseTimeToSec(row.timeInCalls);
      agg.numDials += row.callsAnswered;
      const ck = canonicalizePhonebankerKey(canonicalCaller);
      let set = csvOnlyCallerKeysBySlice.get(sliceKey);
      if (!set) {
        set = new Set();
        csvOnlyCallerKeysBySlice.set(sliceKey, set);
      }
      set.add(ck);
    }
    agg.pollingFaizah += row.pollingFaizah;
    agg.pollingAntiTraci += row.pollingUndecidedB;
    agg.pollingUndecided += row.pollingUndecided;
    agg.pollingTraci += row.pollingTraci;
    const traciSurveyed = row.violationsYes + row.violationsUnsure + row.violationsNo;
    agg.traciSurveyed += traciSurveyed;
    agg.traciYes += row.violationsYes;
    agg.traciUnsure += row.violationsUnsure;
    agg.traciNo += row.violationsNo;
    const finalTotal = row.finalSS + row.finalWontVoteTraci + row.finalUndecided + row.finalSO;
    agg.finalTotal += finalTotal;
    agg.finalSS += row.finalSS;
    agg.finalAntiTraci += row.finalWontVoteTraci;
    agg.finalUndecided += row.finalUndecided;
    agg.finalSO += row.finalSO;
    agg.finalSupport += row.finalSS + row.finalWontVoteTraci;
    agg.finalOppose += row.finalSO;
    agg.canvassTotal +=
      row.canvassAMNA +
      row.canvassCallBack +
      row.canvassDeclined +
      row.canvassDNC +
      row.canvassLangOther +
      row.canvassLangSpanish +
      row.canvassMoved +
      row.canvassWrongNumber +
      row.canvassAnsweringMachine +
      row.canvassVoicemail;
  }

  for (const [sk, callers] of csvOnlyCallerKeysBySlice) {
    const agg = bqSliceMap.get(sk);
    if (agg && !bqSliceKeys.has(sk)) {
      agg.pbers = callers.size;
    }
  }

  mergeTraciViolationStatsFromBq(bqQuestionStats, bqSliceMap);

  const dashboardSlices = Array.from(bqSliceMap.values())
    .filter((s) => !tombstonedSliceKeys.has(s.sliceKey))
    .sort((a, b) => {
      if (a.callDate !== b.callDate) return b.callDate.localeCompare(a.callDate);
      return a.campaignName.localeCompare(b.campaignName);
    });

  const visibleCampaignKeysAll = new Set(
    dashboardSlices.map((s) => normalizeCampaignKey(s.campaignName))
  );
  const phoneBanksForDashboard = phoneBanks.filter((p) =>
    visibleCampaignKeysAll.has(normalizeCampaignKey(p.campaignName))
  );

  const csvSliceKeys = getCsvSliceKeys(tagId);
  const missingSlices = dashboardSlices.filter((s) => bqSliceKeys.has(s.sliceKey) && !csvSliceKeys.has(s.sliceKey));

  const mergedRowsFromBqAndCsv: PhoneBankCsvRow[] = bqDailyCaller.map((row) => {
    const canonicalCaller = canonicalizePhonebankerName(row.phonebankerName);
    const callerKey = `${normalizeCampaignKey(row.campaignName)}|${row.callDate}|${canonicalizePhonebankerKey(canonicalCaller)}`;
    const csvMatch = csvRowsBySliceCaller.get(callerKey);
    const csvAgg = csvMatch?.length ? sumRows(csvMatch) : null;
    const base = blankCsvRow();
    base.date = row.callDate;
    base.phoneBankName = row.campaignName;
    base.callerName = canonicalCaller;
    base.callerNameRaw = row.phonebankerName;
    base.hoursLoggedIn = secToTime(row.totalDialerSeconds);
    base.timeInCalls = secToTime(row.totalCallSeconds);
    base.callsAnswered = row.callsAnswered;
    base.correctPerson = row.talkingToCorrectPerson;
    base.surveyed = row.surveyed;
    if (!csvAgg) return base;
    return {
      ...base,
      ...csvAgg,
      date: row.callDate,
      phoneBankName: row.campaignName,
      callerName: canonicalCaller,
      callerNameRaw: row.phonebankerName,
      hoursLoggedIn: secToTime(row.totalDialerSeconds),
      timeInCalls: secToTime(row.totalCallSeconds),
      callsAnswered: row.callsAnswered,
      correctPerson: row.talkingToCorrectPerson,
      surveyed: row.surveyed,
    };
  });

  const bqOutcomeByCallerSlice = buildPhonebankerBqOutcomeMap(bqQuestionStats, surveyScriptProfile);
  const mergedRowsForPhonebankers = mergedRowsFromBqAndCsv
    .filter((r) => {
      const iso = normalizeDateToIso(r.date);
      if (!iso) return true;
      return !tombstonedSliceKeys.has(makeSliceKey(r.phoneBankName, iso));
    })
    .map((r) => mergePhoneBankRowWithBqOutcomes(r, bqOutcomeByCallerSlice));

  const questionRowsBySlice: Record<string, PbQuestionAnswerRow[]> = {};
  for (const row of bqQuestionStats) {
    const sliceKey = makeSliceKey(row.campaignName, row.callDate);
    if (!questionRowsBySlice[sliceKey]) {
      questionRowsBySlice[sliceKey] = [];
    }
    questionRowsBySlice[sliceKey]!.push({
      phonebankerName: row.phonebankerName,
      questionName: row.questionName,
      answerValue: row.answerValue,
      responseCount: row.responseCount,
    });
  }

  appendCsvOnlyQuestionRowsForPbDashboard(questionRowsBySlice, csvRowsSafe, bqSliceKeys, {
    widePivotHeaders: wideRefHeaders.length > 0 ? wideRefHeaders : undefined,
    savedHeaderFieldMap: wideHeaderFieldMap ?? undefined,
  });

  for (const sk of tombstonedSliceKeys) {
    delete questionRowsBySlice[sk];
  }

  const callerMetricsBySlice: Record<string, TagDailyCallerStat[]> = {};
  for (const row of bqDailyCaller) {
    const sk = makeSliceKey(row.campaignName, row.callDate);
    if (!callerMetricsBySlice[sk]) {
      callerMetricsBySlice[sk] = [];
    }
    callerMetricsBySlice[sk].push(row);
  }

  /** CSV-only days: BQ has no per-banker rows — synthesize from stored CSV so the Data table matches uploads. */
  for (const row of csvRowsSafe) {
    const isoDate = normalizeDateToIso(row.date);
    if (!isoDate) continue;
    const sk = makeSliceKey(row.phoneBankName, isoDate);
    if (bqSliceKeys.has(sk)) continue;
    const canonicalCaller = resolvePhonebankerRep(
      phonebankerRepBySlice,
      row.phoneBankName,
      isoDate,
      normalizeName(row.callerName)
    );
    const displayName = (row.callerNameRaw?.trim() || row.callerName || canonicalCaller).trim();
    const stat: TagDailyCallerStat = {
      campaignId: "",
      campaignName: row.phoneBankName,
      callDate: isoDate,
      phonebankerName: displayName,
      callsAnswered: row.callsAnswered,
      talkingToCorrectPerson: row.correctPerson,
      surveyed: row.surveyed,
      numDials: row.callsAnswered,
      totalCallSeconds: parseTimeToSec(row.timeInCalls),
      totalDialerSeconds: parseTimeToSec(row.hoursLoggedIn),
    };
    if (!callerMetricsBySlice[sk]) callerMetricsBySlice[sk] = [];
    callerMetricsBySlice[sk].push(stat);
  }

  for (const sk of tombstonedSliceKeys) {
    delete callerMetricsBySlice[sk];
  }

  const availableDates = [...new Set(dashboardSlices.map((s) => s.callDate))].sort((a, b) =>
    b.localeCompare(a)
  );
  const activeDate = selectedDate && availableDates.includes(selectedDate) ? selectedDate : "";
  const filteredSlices = activeDate
    ? dashboardSlices.filter((s) => s.callDate === activeDate)
    : dashboardSlices;
  const filteredRowsForPhonebankers = activeDate
    ? mergedRowsForPhonebankers.filter((r) => r.date === activeDate)
    : mergedRowsForPhonebankers;
  const visibleCampaignKeysForDate = new Set(
    filteredSlices.map((s) => normalizeCampaignKey(s.campaignName))
  );
  const filteredPhoneBanks = activeDate
    ? phoneBanksForDashboard.filter((p) =>
        visibleCampaignKeysForDate.has(normalizeCampaignKey(p.campaignName))
      )
    : phoneBanksForDashboard;
  const phoneBanksByCampaignKey = new Map(
    phoneBanks.map((p) => [normalizeCampaignKey(p.campaignName), p] as const)
  );
  const overviewPhoneBanks = activeDate
    ? buildOverviewPhoneBankRowsForSelectedDate(
        filteredSlices,
        callerMetricsBySlice,
        phoneBanksByCampaignKey,
        activeDate
      )
    : filteredPhoneBanks;
  const aggregateSliceKeys = new Set(filteredSlices.map((s) => s.sliceKey));
  const rollupPf = rollupPollingAndFinalAnswers(bqQuestionStats, {
    sliceKeys: aggregateSliceKeys,
    dateFilter: activeDate || null,
    surveyScriptProfile,
  });
  let bqPollingBreakdown = rollupPf.polling;
  let bqFinalResultBreakdown = rollupPf.finalResult;
  let finalResultFromCallFill = false;
  if (
    tag.useCallLevelFinalResultFill &&
    rollupPf.finalResult.length === 0 &&
    bqCallSurveyForFill.length > 0
  ) {
    const filled = aggregateFilledFinalResults(bqCallSurveyForFill, {
      sliceKeys: aggregateSliceKeys,
      dateFilter: activeDate || null,
    });
    if (filled.length > 0) {
      bqFinalResultBreakdown = filled;
      finalResultFromCallFill = true;
    }
  }
  if (bqPollingBreakdown.length > 0) {
    bqPollingBreakdown = consolidateSurveyAnswerLines(bqPollingBreakdown, surveyScriptProfile);
  }
  if (bqFinalResultBreakdown.length > 0 && !verbatimFinalResult) {
    bqFinalResultBreakdown = consolidateSurveyAnswerLines(bqFinalResultBreakdown, surveyScriptProfile);
  }

  const aggregateScopeRows: AggregateScopeQuestionRow[] = [];
  for (const r of bqQuestionStats) {
    const sk = makeSliceKey(r.campaignName, r.callDate);
    if (!aggregateSliceKeys.has(sk)) continue;
    if (activeDate && r.callDate !== activeDate) continue;
    aggregateScopeRows.push({
      questionName: r.questionName,
      answerValue: r.answerValue,
      responseCount: r.responseCount,
    });
  }

  const uniquePbersForAggregate = countUniquePhonebankersForSliceKeys(
    bqDailyCaller,
    aggregateSliceKeys
  );
  /** Date filter: header boxes match daily slices (session-day grain), not phone-bank rollups (can omit campaigns). */
  const headerStatsForSelectedDate = Boolean(activeDate);
  const phoneBankCountBox = headerStatsForSelectedDate
    ? filteredSlices.length
    : filteredPhoneBanks.length;
  const totalDials = headerStatsForSelectedDate
    ? filteredSlices.reduce((s, x) => s + x.numDials, 0)
    : filteredPhoneBanks.reduce((s, p) => s + p.totalDials, 0);
  const totalHours = headerStatsForSelectedDate
    ? Math.round((filteredSlices.reduce((s, x) => s + x.callSeconds, 0) / 3600) * 100) / 100
    : Math.round(filteredPhoneBanks.reduce((s, p) => s + p.totalHours, 0) * 100) / 100;
  const uniqueCallers = headerStatsForSelectedDate
    ? uniquePbersForAggregate
    : filteredPhoneBanks.reduce((s, p) => s + p.uniqueCallers, 0);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-5">
        <Link href="/phonebanking" className="hover:text-indigo-600 transition-colors">
          Phone Banking
        </Link>
        <span>/</span>
        <span className="text-gray-700 dark:text-gray-200 font-medium">{tag.label}</span>
      </nav>

      <div className="mb-4">
        <TagDataRefreshBar
          tagId={tagId}
          enabled={Boolean(process.env.CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET)}
          dataUpdatedAtIso={snapshotMeta.dataUpdatedAt}
          dataUpdatedAtLabel={snapshotMeta.dataUpdatedAtLabel}
          isStale={snapshotMeta.isStale}
          hasSnapshotData={snapshotMeta.hasDailyCaller}
        />
        <TombstoneOverlapAfterRefresh tagId={tagId} />
      </div>

      {snapshotMode && !snapshotMeta.hasDailyCaller ? (
        <div
          className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/25 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
          role="status"
        >
          <p className="font-medium">No BigQuery snapshot on disk for this tag yet.</p>
          <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-200/90 leading-snug">
            Normal page loads read saved files only (no live BigQuery). After you run{" "}
            <strong>Refresh this tag</strong> or <strong>Refresh all tags</strong>, totals and phone banks appear here
            until the next refresh.
          </p>
        </div>
      ) : null}

      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{ backgroundColor: tag.color }}
          />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{tag.label}</h1>
            {tag.navGroup ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{tag.navGroup}</p>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 min-w-0 lg:w-auto">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400">Phone Banks</div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">{phoneBankCountBox}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400">Total Dials</div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">{totalDials.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400">Call Time</div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">{fmtHours(totalHours)}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400">Callers</div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">{uniqueCallers.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3 mb-5">
        {filteredSlices.length > 0 && (
          <DailyAggregateSection
            tagId={tagId}
            basePath={`/phonebanking/${tagId}`}
            activeTab={tab}
            availableDates={availableDates}
            activeDate={activeDate}
            dateLabel={activeDate || "All dates"}
            slices={filteredSlices}
            uniquePhonebankers={uniquePbersForAggregate}
            showPollingAggregate={tag.showPollingAggregate !== false}
            bqPollingBreakdown={bqPollingBreakdown}
            bqFinalResultBreakdown={bqFinalResultBreakdown}
            finalResultFromCallFill={finalResultFromCallFill}
            aggregateLexicon={aggregateLexicon}
            finalResultUsesScriptOptionLabels={verbatimFinalResult}
            aggregateScopeRows={aggregateScopeRows}
            surveyScriptProfile={surveyScriptProfile}
          />
        )}
        {process.env.CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET ? (
          <BqSnapshotRefreshPanel
            tagId={tagId}
            dataUpdatedAtIso={snapshotMeta.dataUpdatedAt}
            dataUpdatedAtLabel={snapshotMeta.dataUpdatedAtLabel}
            isStale={snapshotMeta.isStale}
            hasSnapshotData={snapshotMeta.hasDailyCaller}
          />
        ) : null}
      </div>

      {bqError && (
        <div className="mb-5">
          <ErrorBanner message={bqError} />
        </div>
      )}

      {/* Tab bar */}
      <Suspense fallback={null}>
        <TabBar tabs={TABS} defaultTab="overview" />
      </Suspense>

      <TagHiddenSlicesBar tagId={tagId} hidden={hiddenSlicesForRestore} />

      {/* ── TAB: Overview ─────────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-8">
          {/* Phone bank list from BigQuery */}
          <section>
            <h2 className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-3">All Phone Banks</h2>
            <PhoneBankTable phoneBanks={overviewPhoneBanks} tagId={tagId} tagColor={tag.color} />
          </section>
        </div>
      )}

      {/* ── TAB: By Phone Bank (Aggregate) ────────────────────────────────────── */}
      {tab === "aggregate" && (
        <div className="space-y-3">
          <PbDashboardStack
            tagId={tagId}
            csvSliceKeys={csvSliceKeysForPbDashboard}
            slices={filteredSlices}
            questionRowsBySlice={questionRowsBySlice}
            callerMetricsBySlice={callerMetricsBySlice}
            surveyScriptProfile={surveyScriptProfile}
            finalResultBucketsFootnoteLead={aggregateLexicon.finalResultBucketsFootnoteLead}
            verbatimFinalResultLabels={verbatimFinalResult}
            syntheticPivotAllowlistByQuestion={syntheticPivotAllowlistByQuestion}
            widePivotHeaderOrderHint={wideRefHeaders.length > 0 ? wideRefHeaders : undefined}
          />
        </div>
      )}

      {/* ── TAB: Phonebankers ─────────────────────────────────────────────────── */}
      {tab === "phonebankers" && (
        <div className="space-y-3">
          <PhonebankerAggregateTable
            rows={filteredRowsForPhonebankers}
            otherPositiveColumnLabel={aggregateLexicon.phonebankerOtherPositiveColumnLabel}
            extraWideColumnOrder={wideExtraColumnOrder}
          />
        </div>
      )}

      {tab === "csv" && (
        <div className="space-y-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">CSV data</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Uploads, replacements, and deletes are handled in the dedicated CSV hub (same Google Sheets export format).
            {csvUploadedAt ? (
              <>
                {" "}
                Last saved: <span className="font-medium text-gray-800 dark:text-gray-200">{csvUploadedAt}</span>
              </>
            ) : null}
          </p>
          <Link
            href={`/phonebanking/csv-upload?tag=${encodeURIComponent(tagId)}`}
            className="inline-flex items-center rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-sm font-semibold"
          >
            Open CSV upload hub
          </Link>
          {missingSlices.length > 0 ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Missing campaign-day slices from CSV: {missingSlices.length}. Examples:{" "}
              {missingSlices.slice(0, 6).map((s) => `${s.campaignName} ${s.callDate}`).join(", ")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
  });
}


function NoCsvPlaceholder({
  tagId,
  uploadedAt,
}: {
  tagId: string;
  uploadedAt: string | null;
}) {
  void tagId;
  return (
    <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-10 text-center">
      <p className="text-3xl mb-3">📂</p>
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">No CSV data uploaded yet</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
        Export your Google Sheets phone bank data as CSV and upload it above to see the{" "}
        {uploadedAt ? "updated" : "full"} spreadsheet view here.
      </p>
    </div>
  );
}
