/**
 * Builds the same dashboard structures as `/phonebanking/[tag]` (slice map, merges, phonebanker rows)
 * but aggregates **all** phonebanking tags for a single Pacific calendar day.
 *
 * Uses per-tag BigQuery snapshots/APIs and merges CSV rows from every tag’s upload — matching candidate pages.
 */

import { getPhonebankingTags } from "@/lib/campaign-tags";
import type { DashboardAggregateLexicon } from "@/lib/dashboard-aggregate-lexicon";
import { getDashboardAggregateLexicon } from "@/lib/dashboard-aggregate-lexicon";
import {
  fetchTagDailyCallerStats,
  fetchTagPhonebankerQuestionStats,
  isValidPhonebankingIsoDate,
  tagDailyCallerHasWorkBeyondLoggedHours,
  fetchAllPhoneBankSummariesForDate,
} from "@/lib/queries/phonebanking";
import { loadCsvData } from "@/lib/csv-store";
import { loadExtraWideColumnOrder } from "@/lib/stw-extra-wide-column-order-store";
import { loadWideHeaderFieldMap } from "@/lib/stw-wide-header-field-map-store";
import { loadWideReferenceHeaders } from "@/lib/stw-wide-reference-store";
import { appendCsvOnlyQuestionRowsForPbDashboard, getSyntheticPivotAllowlistFromWideHeaders } from "@/lib/csv-slice-question-synthesis";
import type {
  PbDashboardSlice,
  PbQuestionAnswerRow,
} from "@/components/phonebanking/PbDashboardStack";
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
  type CampaignTag,
  type PhoneBankCsvRow,
  type PhoneBankSummary,
  type PhonebankerQuestionResponseStat,
  type SurveyScriptProfile,
  type TagDailyCallerStat,
} from "@/lib/types";
import { normalizeName, parseTimeToSec, secToTime, sumRows } from "@/lib/csv-parser";
import { mergeTraciViolationStatsFromBq } from "@/lib/traci-violation-bq";
import { withInferredContactMetrics } from "@/lib/infer-csv-contact-metrics";
import {
  buildPhonebankerBqOutcomeMap,
  mergePhoneBankRowWithBqOutcomes,
} from "@/lib/phonebanker-bq-outcomes";

const ALL_CAMPAIGNS_PAGE_TAG: CampaignTag = {
  id: "_all_campaigns",
  label: "All campaigns",
  searchTerms: [],
  color: "#6366f1",
  textColor: "#ffffff",
  mode: "phonebanking",
};

export type AllCampaignsDayDashboardPayload = {
  overviewPhoneBanks: PhoneBankSummary[];
  filteredSlices: PbDashboardSlice[];
  questionRowsBySlice: Record<string, PbQuestionAnswerRow[]>;
  callerMetricsBySlice: Record<string, TagDailyCallerStat[]>;
  mergedRowsForPhonebankers: PhoneBankCsvRow[];
  surveyScriptProfile: SurveyScriptProfile;
  aggregateLexicon: DashboardAggregateLexicon;
  syntheticPivotAllowlistByQuestion?: Record<string, readonly string[]>;
  widePivotHeaderOrderHint?: readonly string[];
  extraWideColumnOrder?: string[];
};

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

/**
 * When a date is selected, align overview list with slice + caller rows (same as tag page).
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

export async function buildAllCampaignsDayDashboard(
  isoDate: string
): Promise<AllCampaignsDayDashboardPayload | { error: string }> {
  if (!isValidPhonebankingIsoDate(isoDate)) {
    return { error: "Invalid date" };
  }

  const tags = getPhonebankingTags();
  if (!tags.length) {
    return { error: "No phonebanking tags configured" };
  }

  const surveyScriptProfile: SurveyScriptProfile = "genericChallenger";
  const aggregateLexicon = getDashboardAggregateLexicon(ALL_CAMPAIGNS_PAGE_TAG, surveyScriptProfile);

  const tagResults = await Promise.all(
    tags.map(async (tag) => {
      const [daily, questions] = await Promise.all([
        fetchTagDailyCallerStats(tag.id),
        fetchTagPhonebankerQuestionStats(tag.id),
      ]);
      const csv = (loadCsvData(tag.id) ?? []).map(withInferredContactMetrics);
      const wideExtraColumnOrder = loadExtraWideColumnOrder(tag.id);
      const wideRefHeaders = loadWideReferenceHeaders(tag.id) ?? [];
      const wideHeaderFieldMap = loadWideHeaderFieldMap(tag.id);
      return {
        tag,
        daily,
        questions,
        csv,
        wideExtraColumnOrder,
        wideRefHeaders,
        wideHeaderFieldMap,
      };
    })
  );

  let bqDailyCaller: TagDailyCallerStat[] = [];
  let bqQuestionStats: PhonebankerQuestionResponseStat[] = [];

  const csvRowsSafe: PhoneBankCsvRow[] = [];
  const headerOrders: string[][] = [];
  const wideHeaderFieldMaps: ReturnType<typeof loadWideHeaderFieldMap>[] = [];
  const wideRefHeadersList: string[][] = [];

  for (const tr of tagResults) {
    bqDailyCaller.push(...tr.daily.filter((r) => r.callDate === isoDate));
    bqQuestionStats.push(...tr.questions.filter((r) => r.callDate === isoDate));
    for (const row of tr.csv) {
      const d = normalizeDateToIso(row.date);
      if (d === isoDate) csvRowsSafe.push(row);
    }
    if (tr.wideExtraColumnOrder?.length) headerOrders.push(tr.wideExtraColumnOrder);
    if (tr.wideRefHeaders.length) wideRefHeadersList.push(tr.wideRefHeaders);
    if (tr.wideHeaderFieldMap) wideHeaderFieldMaps.push(tr.wideHeaderFieldMap);
  }

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
  ).filter(tagDailyCallerHasWorkBeyondLoggedHours);

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

  const csvOnlyCallerKeysBySlice = new Map<string, Set<string>>();

  for (const row of csvRowsSafe) {
    const iso = normalizeDateToIso(row.date);
    if (!iso) continue;
    const canonicalCaller = resolvePhonebankerRep(
      phonebankerRepBySlice,
      row.phoneBankName,
      iso,
      normalizeName(row.callerName)
    );
    const sliceKey = makeSliceKey(row.phoneBankName, iso);
    if (!bqSliceMap.has(sliceKey)) {
      bqSliceMap.set(sliceKey, {
        sliceKey,
        campaignName: row.phoneBankName,
        callDate: iso,
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

  const dashboardSlices = Array.from(bqSliceMap.values()).sort((a, b) => {
    if (a.callDate !== b.callDate) return b.callDate.localeCompare(a.callDate);
    return a.campaignName.localeCompare(b.campaignName);
  });

  const filteredSlices = dashboardSlices.filter((s) => s.callDate === isoDate);

  const csvRowsBySliceCaller = new Map<string, PhoneBankCsvRow[]>();
  for (const row of csvRowsSafe) {
    const d = normalizeDateToIso(row.date);
    if (!d) continue;
    const canonicalCaller = resolvePhonebankerRep(
      phonebankerRepBySlice,
      row.phoneBankName,
      d,
      normalizeName(row.callerName)
    );
    const key = `${normalizeCampaignKey(row.phoneBankName)}|${d}|${canonicalizePhonebankerKey(canonicalCaller)}`;
    const existing = csvRowsBySliceCaller.get(key) ?? [];
    existing.push({
      ...row,
      callerName: canonicalCaller,
      callerNameRaw: row.callerNameRaw || row.callerName,
    });
    csvRowsBySliceCaller.set(key, existing);
  }

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
  const mergedRowsForPhonebankers = mergedRowsFromBqAndCsv.map((r) =>
    mergePhoneBankRowWithBqOutcomes(r, bqOutcomeByCallerSlice)
  );

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

  const aggregateSliceKeys = new Set(filteredSlices.map((s) => s.sliceKey));
  let syntheticPivotAllowlistByQuestion: Record<string, readonly string[]> | undefined;
  const bestWideRef =
    wideRefHeadersList.reduce(
      (longest, cur) => (cur.length > longest.length ? cur : longest),
      [] as readonly string[]
    ) ?? [];

  if (bestWideRef.length > 0) {
    const mergedFieldMap = wideHeaderFieldMaps[0] ?? undefined;
    syntheticPivotAllowlistByQuestion = Object.fromEntries(
      [...getSyntheticPivotAllowlistFromWideHeaders([...bestWideRef], mergedFieldMap)].map(([q, set]) => [
        q,
        [...set],
      ])
    );
  }

  appendCsvOnlyQuestionRowsForPbDashboard(questionRowsBySlice, csvRowsSafe, bqSliceKeys, {
    widePivotHeaders: bestWideRef.length > 0 ? bestWideRef : undefined,
    savedHeaderFieldMap: wideHeaderFieldMaps[0] ?? undefined,
  });

  const callerMetricsBySlice: Record<string, TagDailyCallerStat[]> = {};
  for (const row of bqDailyCaller) {
    const sk = makeSliceKey(row.campaignName, row.callDate);
    if (!aggregateSliceKeys.has(sk)) continue;
    if (!callerMetricsBySlice[sk]) {
      callerMetricsBySlice[sk] = [];
    }
    callerMetricsBySlice[sk].push(row);
  }

  for (const row of csvRowsSafe) {
    const iso = normalizeDateToIso(row.date);
    if (!iso || iso !== isoDate) continue;
    const sk = makeSliceKey(row.phoneBankName, iso);
    if (bqSliceKeys.has(sk)) continue;
    const canonicalCaller = resolvePhonebankerRep(
      phonebankerRepBySlice,
      row.phoneBankName,
      iso,
      normalizeName(row.callerName)
    );
    const displayName = (row.callerNameRaw?.trim() || row.callerName || canonicalCaller).trim();
    const stat: TagDailyCallerStat = {
      campaignId: "",
      campaignName: row.phoneBankName,
      callDate: iso,
      phonebankerName: displayName,
      callsAnswered: row.callsAnswered,
      talkingToCorrectPerson: row.correctPerson,
      surveyed: row.surveyed,
      numDials: row.callsAnswered,
      totalCallSeconds: parseTimeToSec(row.timeInCalls),
      totalDialerSeconds: parseTimeToSec(row.hoursLoggedIn),
    };
    if (!aggregateSliceKeys.has(sk)) continue;
    if (!callerMetricsBySlice[sk]) callerMetricsBySlice[sk] = [];
    callerMetricsBySlice[sk].push(stat);
  }

  const phoneBanksDay = await fetchAllPhoneBankSummariesForDate(isoDate);
  const phoneBanksByCampaignKey = new Map(
    phoneBanksDay.map((p) => [normalizeCampaignKey(p.campaignName), p] as const)
  );
  const overviewPhoneBanks = buildOverviewPhoneBankRowsForSelectedDate(
    filteredSlices,
    callerMetricsBySlice,
    phoneBanksByCampaignKey,
    isoDate
  );

  const extraWideColumnOrder = headerOrders
    .reduce((acc, cur) => (cur.length > acc.length ? cur : acc), [] as string[]);

  return {
    overviewPhoneBanks,
    filteredSlices,
    questionRowsBySlice,
    callerMetricsBySlice,
    mergedRowsForPhonebankers,
    surveyScriptProfile,
    aggregateLexicon,
    syntheticPivotAllowlistByQuestion,
    widePivotHeaderOrderHint: bestWideRef.length ? bestWideRef : undefined,
    extraWideColumnOrder: extraWideColumnOrder.length ? extraWideColumnOrder : undefined,
  };
}
