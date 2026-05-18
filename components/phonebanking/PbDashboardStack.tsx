"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCallsPerLoggedInHour } from "@/lib/calls-rate";
import { formatShortUsDate } from "@/lib/slice-key";
import { canonicalizePhonebankerName } from "@/lib/phonebanker-name";
import { isTraciViolationQuestion } from "@/lib/traci-violation-bq";
import { formatSurveyColumnHeader, isSpanishPhonebankSlice } from "@/lib/survey-i18n/column-label-gloss";
import {
  effectiveFinalResultAnswerLabelForRollup,
  rollupFinalResultRawAnswerLines,
  sumAnswerLines,
} from "@/lib/daily-aggregate-survey-rollup";
import { questionLooksLikeDisclaimer } from "@/lib/survey-i18n/rules";
import { consolidateSurveyAnswerLines } from "@/lib/survey-answer-consolidation";
import { getCsvSyntheticPivotAnswersByQuestion, filterWidePivotImportHeaders, sortWidePivotQuestionKeysByImportOrder } from "@/lib/csv-slice-question-synthesis";
import { parseWideScriptSortKey, sortPivotQuestionsByWideHeaderHint } from "@/lib/wide-csv-column-order";
import type { SurveyScriptProfile, TagDailyCallerStat } from "@/lib/types";
import { clearTombstonesForTag } from "@/lib/tombstone-client";
import {
  buildCombinedPivotTablesCsv,
  downloadCsvFile,
  pivotExportFilename,
  pivotTsvToCsv,
} from "@/lib/pivot-csv-export";

type PendingSliceUndo = {
  sliceKey: string;
  hadCsv: boolean;
};

export type PbDashboardSlice = {
  sliceKey: string;
  campaignName: string;
  callDate: string;
  /** Sum of dial counts for this campaign×day (from daily caller rows). */
  numDials: number;
  pbers: number;
  callsAnswered: number;
  talkingToCorrectPerson: number;
  loggedInSeconds: number;
  callSeconds: number;
  surveyed: number;
  pollingFaizah: number;
  pollingAntiTraci: number;
  pollingUndecided: number;
  pollingTraci: number;
  traciSurveyed: number;
  traciYes: number;
  traciUnsure: number;
  traciNo: number;
  finalTotal: number;
  finalSS: number;
  finalAntiTraci: number;
  finalUndecided: number;
  finalSO: number;
  finalSupport: number;
  finalOppose: number;
  canvassTotal: number;
};

export type PbQuestionAnswerRow = {
  phonebankerName: string;
  questionName: string;
  answerValue: string;
  responseCount: number;
};

type PivotColumn = {
  key: string;
  questionName: string;
  answerValue: string;
};

const CSV_SYNTHETIC_PIVOT_SCHEMA = getCsvSyntheticPivotAnswersByQuestion();

/**
 * Sort synthetic dashboard buckets next to the script step they correspond to (Faizah–Traci style).
 * Letter 950 places rollup columns after same-number wide headers (e.g. all `03 Polling: …` before the `Polling` bucket).
 */
const SYNTHETIC_QUESTION_SCRIPT_BLOCK: Record<string, number> = {
  "Canvass non-contact": 2,
  "Polling": 3,
  "Faizah pitch": 4,
  "Not Traci Park": 5,
  "Final result": 6,
  "Donate": 7,
  "Disclaimer": 8,
  "Flyer": 9,
  "Traci violations rap": 10,
  "Vote plan": 11,
};

const SYNTHETIC_SORT_LETTER = 950;

const SYNTHETIC_ROLLUP_QUESTION_NAMES = new Set(Object.keys(SYNTHETIC_QUESTION_SCRIPT_BLOCK));

/** Wide-import pivot: entire script cell is `questionName`, answer column is empty. */
function isWideCsvFullHeaderQuestionRow(questionName: string, answerValue: string): boolean {
  if ((answerValue ?? "").trim() !== "") return false;
  const q = questionName.trim();
  return /^\d+\s.+\s*:\s*[A-Za-z]\./.test(q);
}

/** BigQuery-style stats: `01 Petition` + `A. Yes`, not `01 Petition: A. Yes` + empty answer. */
function sliceRowsLookLikeBqSplitScript(rows: PbQuestionAnswerRow[]): boolean {
  for (const r of rows) {
    if (questionLooksLikeDisclaimer(r.questionName)) continue;
    if (isWideCsvFullHeaderQuestionRow(r.questionName, r.answerValue)) continue;
    if (/^\d{1,2}\s/.test(r.questionName.trim())) return true;
  }
  return false;
}

function wideHeaderOrderRank(headerOrder: readonly string[], questionName: string): number {
  const q = questionName.trim();
  let best = 1e9;
  for (let i = 0; i < headerOrder.length; i++) {
    const h = headerOrder[i]!.trim();
    if (h === q || h.startsWith(`${q}:`)) best = Math.min(best, i);
  }
  return best;
}

function pivotQuestionSortMeta(questionName: string): { section: number; letter: number } {
  const block = SYNTHETIC_QUESTION_SCRIPT_BLOCK[questionName];
  if (block !== undefined) {
    return { section: block, letter: SYNTHETIC_SORT_LETTER };
  }
  return parseWideScriptSortKey(questionName);
}

function comparePivotQuestionNames(
  a: string,
  b: string,
  headerOrderHint?: readonly string[]
): number {
  const ma = pivotQuestionSortMeta(a);
  const mb = pivotQuestionSortMeta(b);
  if (ma.section !== mb.section) return ma.section - mb.section;
  if (ma.letter !== mb.letter) return ma.letter - mb.letter;
  if (headerOrderHint?.length) {
    const ia = wideHeaderOrderRank(headerOrderHint, a);
    const ib = wideHeaderOrderRank(headerOrderHint, b);
    if (ia !== ib) return ia - ib;
  }
  return a.localeCompare(b);
}

function fillMissingSyntheticPivotColumns(
  colByKey: Map<string, PivotColumn>,
  schema: ReadonlyMap<string, readonly string[]>,
  allowlistByQuestion?: Readonly<Record<string, readonly string[]>> | null
): void {
  const allowMap =
    allowlistByQuestion && Object.keys(allowlistByQuestion).length > 0
      ? new Map(Object.entries(allowlistByQuestion).map(([q, arr]) => [q, new Set(arr)]))
      : null;

  for (const [qName] of schema) {
    const hasAny = [...colByKey.keys()].some((k) => k.startsWith(`${qName}::`));
    if (!hasAny) continue;

    const answersToEnsure = new Set<string>();
    for (const k of colByKey.keys()) {
      if (!k.startsWith(`${qName}::`)) continue;
      const av = k.slice(qName.length + 2);
      if (av) answersToEnsure.add(av);
    }
    if (allowMap) {
      const allowed = allowMap.get(qName);
      if (allowed?.size) {
        for (const av of allowed) answersToEnsure.add(av);
      }
    }

    for (const av of answersToEnsure) {
      const key = `${qName}::${av}`;
      if (!colByKey.has(key)) {
        colByKey.set(key, { key, questionName: qName, answerValue: av });
      }
    }
  }
}

function fillMissingWideScriptHeaders(colByKey: Map<string, PivotColumn>, order: readonly string[]): void {
  for (const header of order) {
    const t = header.trim();
    if (!t) continue;
    const key = `${t}::`;
    if (!colByKey.has(key)) {
      colByKey.set(key, { key, questionName: t, answerValue: "" });
    }
  }
}

function comparePivotAnswersSameQuestion(a: PivotColumn, b: PivotColumn): number {
  const va = parseWideScriptSortKey(a.answerValue);
  const vb = parseWideScriptSortKey(b.answerValue);
  if (va.section !== vb.section) return va.section - vb.section;
  if (va.letter !== vb.letter) return va.letter - vb.letter;
  if (a.answerValue === "[No Answer Recorded]") return 1;
  if (b.answerValue === "[No Answer Recorded]") return -1;
  const cmp = a.answerValue.localeCompare(b.answerValue);
  if (cmp !== 0) return cmp;
  return a.key.localeCompare(b.key);
}

function secToTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function escapeTsvCell(v: string | number): string {
  return String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

/** Pivot grid only (Question Responses by Phonebanker), for clipboard (TSV) and CSV download conversion. */
function buildQuestionResponsesPivotTsv(
  surveyScriptProfile: SurveyScriptProfile,
  spanishSlice: boolean,
  slice: PbDashboardSlice,
  renderedColumns: PivotColumn[],
  hasPivot: boolean,
  sortedBankers: string[],
  metricsByBanker: Map<string, TagDailyCallerStat>,
  rowsByPhonebanker: Map<string, PbQuestionAnswerRow[]>,
  allRows: PbQuestionAnswerRow[]
): string {
  const baseHeaders = [
    "Phonebanker",
    "Hrs logged in",
    "Time in calls",
    "Calls answered",
    "Correct person",
    "Surveyed",
  ];
  const pivotHeaders = hasPivot
    ? renderedColumns.map((col) =>
        [
          formatSurveyColumnHeader(col.questionName, {
            spanishSlice,
            role: "question",
            profile: surveyScriptProfile,
          }),
          formatSurveyColumnHeader(col.answerValue, {
            spanishSlice,
            role: "answer",
            profile: surveyScriptProfile,
          }),
        ].join(" — ")
      )
    : [];
  const headers = [...baseHeaders, ...pivotHeaders];
  const lines: string[] = [headers.map(escapeTsvCell).join("\t")];

  const totalCells: (string | number)[] = [
    "TOTAL",
    secToTime(slice.loggedInSeconds),
    secToTime(slice.callSeconds),
    slice.callsAnswered,
    slice.talkingToCorrectPerson,
    slice.surveyed,
  ];
  if (hasPivot) {
    for (const col of renderedColumns) {
      const total = allRows.reduce((s, r) => {
        return s + (`${r.questionName}::${r.answerValue}` === col.key ? r.responseCount : 0);
      }, 0);
      totalCells.push(total);
    }
  }
  lines.push(totalCells.map(escapeTsvCell).join("\t"));

  for (const phonebankerName of sortedBankers) {
    const m = metricsByBanker.get(phonebankerName);
    const pRows = rowsByPhonebanker.get(phonebankerName) ?? [];
    const valMap = new Map<string, number>();
    for (const row of pRows) {
      const k = `${row.questionName}::${row.answerValue}`;
      valMap.set(k, (valMap.get(k) ?? 0) + row.responseCount);
    }
    const rowCells: (string | number)[] = [
      phonebankerName,
      m ? secToTime(m.totalDialerSeconds) : "—",
      m ? secToTime(m.totalCallSeconds) : "—",
      m ? m.callsAnswered : "—",
      m ? m.talkingToCorrectPerson : "—",
      m ? m.surveyed : "—",
    ];
    if (hasPivot) {
      for (const col of renderedColumns) {
        rowCells.push(valMap.get(col.key) ?? 0);
      }
    }
    lines.push(rowCells.map(escapeTsvCell).join("\t"));
  }

  return lines.join("\n");
}

type SliceRenderModel = {
  slice: PbDashboardSlice;
  hrsPerPber: string;
  callPct: string;
  secsPerCall: number;
  rows: PbQuestionAnswerRow[];
  spanishSlice: boolean;
  rowsByPhonebanker: Map<string, PbQuestionAnswerRow[]>;
  sortedPivotQuestionKeys: string[];
  prunedQuestionGroups: Map<string, PivotColumn[]>;
  renderedColumns: PivotColumn[];
  callerRows: TagDailyCallerStat[];
  metricsByBanker: Map<string, TagDailyCallerStat>;
  sortedBankers: string[];
  hasPivot: boolean;
  showTable: boolean;
  finalResultRawLines: ReturnType<typeof rollupFinalResultRawAnswerLines>;
  finalResultConsolidated:
    | ReturnType<typeof rollupFinalResultRawAnswerLines>
    | ReturnType<typeof consolidateSurveyAnswerLines>;
  finalResultPivotRawTotal: number;
  showFinalResultBucketSummary: boolean;
  pivotTsv: string;
};

function computeSliceRenderModel(
  slice: PbDashboardSlice,
  questionRowsBySlice: Record<string, PbQuestionAnswerRow[]>,
  callerMetricsBySlice: Record<string, TagDailyCallerStat[]>,
  surveyScriptProfile: SurveyScriptProfile,
  syntheticPivotAllowlistByQuestion: Readonly<Record<string, readonly string[]>> | undefined,
  widePivotHeaderOrderHint: readonly string[] | undefined,
  verbatimFinalResultLabels: boolean
): SliceRenderModel {
  const hrsPerPber = slice.pbers ? (slice.loggedInSeconds / 3600 / slice.pbers).toFixed(2) : "0.00";
  const callPct = pct(slice.callSeconds, slice.loggedInSeconds);
  const secsPerCall = slice.callsAnswered ? Math.round(slice.callSeconds / slice.callsAnswered) : 0;

  const rows = questionRowsBySlice[slice.sliceKey] ?? [];
  const spanishSlice = isSpanishPhonebankSlice(slice.campaignName, rows);
  const rowsByPhonebanker = new Map<string, PbQuestionAnswerRow[]>();
  const colKeySet = new Set<string>();
  const colByKey = new Map<string, PivotColumn>();
  const hideSyntheticRollups = sliceRowsLookLikeBqSplitScript(rows);

  for (const row of rows) {
    if (questionLooksLikeDisclaimer(row.questionName)) {
      continue;
    }
    const bankerKey = canonicalizePhonebankerName(row.phonebankerName);
    const arr = rowsByPhonebanker.get(bankerKey) ?? [];
    arr.push(row);
    rowsByPhonebanker.set(bankerKey, arr);

    const key = `${row.questionName}::${row.answerValue}`;
    if (!colKeySet.has(key)) {
      colKeySet.add(key);
      colByKey.set(key, {
        key,
        questionName: row.questionName,
        answerValue: row.answerValue,
      });
    }
  }

  if (!hideSyntheticRollups) {
    fillMissingSyntheticPivotColumns(colByKey, CSV_SYNTHETIC_PIVOT_SCHEMA, syntheticPivotAllowlistByQuestion);
  }
  const pivotHintHeaders =
    widePivotHeaderOrderHint?.length && !hideSyntheticRollups
      ? filterWidePivotImportHeaders(widePivotHeaderOrderHint)
      : [];
  if (pivotHintHeaders.length > 0) {
    fillMissingWideScriptHeaders(colByKey, pivotHintHeaders);
  }

  const pivotColumnsAll = Array.from(colByKey.values());
  const questionGroups = new Map<string, PivotColumn[]>();
  for (const col of pivotColumnsAll) {
    const arr = questionGroups.get(col.questionName) ?? [];
    arr.push(col);
    questionGroups.set(col.questionName, arr);
  }

  const prunedQuestionGroups = new Map<string, PivotColumn[]>();
  for (const [question, cols] of questionGroups.entries()) {
    if (hideSyntheticRollups && SYNTHETIC_ROLLUP_QUESTION_NAMES.has(question)) {
      continue;
    }
    if (isTraciViolationQuestion(question)) {
      const hasRecordedAnswer = cols.some((c) => c.answerValue !== "[No Answer Recorded]");
      if (!hasRecordedAnswer) continue;
    }
    prunedQuestionGroups.set(question, cols);
  }

  const questionKeys = [...prunedQuestionGroups.keys()];
  const sortedPivotQuestionKeys =
    pivotHintHeaders.length > 0
      ? sliceRowsLookLikeBqSplitScript(rows)
        ? sortPivotQuestionsByWideHeaderHint(questionKeys, pivotHintHeaders, (a, b) =>
            comparePivotQuestionNames(a, b, widePivotHeaderOrderHint)
          )
        : sortWidePivotQuestionKeysByImportOrder(questionKeys, pivotHintHeaders)
      : [...questionKeys].sort((a, b) => comparePivotQuestionNames(a, b, widePivotHeaderOrderHint));
  const renderedColumns: PivotColumn[] = [];
  for (const q of sortedPivotQuestionKeys) {
    const cols = prunedQuestionGroups.get(q);
    if (!cols?.length) continue;
    renderedColumns.push(...[...cols].sort(comparePivotAnswersSameQuestion));
  }

  const callerRows = callerMetricsBySlice[slice.sliceKey] ?? [];
  const metricsByBanker = new Map<string, TagDailyCallerStat>();
  for (const r of callerRows) {
    const key = canonicalizePhonebankerName(r.phonebankerName);
    const prev = metricsByBanker.get(key);
    if (!prev) {
      metricsByBanker.set(key, { ...r, phonebankerName: key });
    } else {
      metricsByBanker.set(key, {
        ...prev,
        callsAnswered: prev.callsAnswered + r.callsAnswered,
        talkingToCorrectPerson: prev.talkingToCorrectPerson + r.talkingToCorrectPerson,
        surveyed: prev.surveyed + r.surveyed,
        numDials: prev.numDials + r.numDials,
        totalCallSeconds: prev.totalCallSeconds + r.totalCallSeconds,
        totalDialerSeconds: prev.totalDialerSeconds + r.totalDialerSeconds,
      });
    }
  }

  const bankerNameSet = new Set<string>();
  for (const n of rowsByPhonebanker.keys()) {
    bankerNameSet.add(canonicalizePhonebankerName(n));
  }
  for (const r of callerRows) {
    bankerNameSet.add(canonicalizePhonebankerName(r.phonebankerName));
  }
  const sortedBankers = [...bankerNameSet].sort((a, b) => a.localeCompare(b));
  const hasPivot = renderedColumns.length > 0;
  const showTable = sortedBankers.length > 0 || hasPivot;

  const finalResultRawLines = rollupFinalResultRawAnswerLines(rows);
  const finalResultConsolidated =
    finalResultRawLines.length > 0
      ? verbatimFinalResultLabels
        ? finalResultRawLines
        : consolidateSurveyAnswerLines(finalResultRawLines, surveyScriptProfile)
      : [];
  const finalResultPivotRawTotal = rows.reduce((s, r) => {
    const label = effectiveFinalResultAnswerLabelForRollup(r.questionName, r.answerValue);
    if (!label) return s;
    return s + r.responseCount;
  }, 0);
  const showFinalResultBucketSummary =
    finalResultConsolidated.length > 0 && finalResultPivotRawTotal > 0;

  const pivotTsv = showTable
    ? buildQuestionResponsesPivotTsv(
        surveyScriptProfile,
        spanishSlice,
        slice,
        renderedColumns,
        hasPivot,
        sortedBankers,
        metricsByBanker,
        rowsByPhonebanker,
        rows
      )
    : "";

  return {
    slice,
    hrsPerPber,
    callPct,
    secsPerCall,
    rows,
    spanishSlice,
    rowsByPhonebanker,
    sortedPivotQuestionKeys,
    prunedQuestionGroups,
    renderedColumns,
    callerRows,
    metricsByBanker,
    sortedBankers,
    hasPivot,
    showTable,
    finalResultRawLines,
    finalResultConsolidated,
    finalResultPivotRawTotal,
    showFinalResultBucketSummary,
    pivotTsv,
  };
}

export default function PbDashboardStack({
  slices,
  questionRowsBySlice,
  callerMetricsBySlice,
  surveyScriptProfile,
  finalResultBucketsFootnoteLead,
  verbatimFinalResultLabels = false,
  syntheticPivotAllowlistByQuestion,
  widePivotHeaderOrderHint,
  tagId,
  csvSliceKeys,
  exportFilenameDate,
}: {
  slices: PbDashboardSlice[];
  questionRowsBySlice: Record<string, PbQuestionAnswerRow[]>;
  callerMetricsBySlice: Record<string, TagDailyCallerStat[]>;
  surveyScriptProfile: SurveyScriptProfile;
  /** e.g. "Ada script" / "Faizah–Traci script" — shown in final-result bucket explainer. */
  finalResultBucketsFootnoteLead: string;
  /** When true, list raw Final Result answer labels (same as Daily Aggregate), not merged buckets. */
  verbatimFinalResultLabels?: boolean;
  /**
   * Synthetic pivot answers to show as zero columns when absent for a slice — derived from last wide
   * import headers so the grid matches the STW converter (not the full internal pivot schema).
   */
  syntheticPivotAllowlistByQuestion?: Readonly<Record<string, readonly string[]>>;
  /** Last imported wide CSV header row — column order + zero-fill for CSV-only slices. */
  widePivotHeaderOrderHint?: readonly string[];
  /** When set, slice cards get delete/hide that target this tag’s CSV + tombstones. */
  tagId?: string;
  /** Slice keys that have saved CSV rows (from `getCsvSliceKeys` on the server). */
  csvSliceKeys?: readonly string[];
  /** Pacific day label for combined pivot CSV filename (e.g. all-campaigns day filter). */
  exportFilenameDate?: string;
}) {
  if (!slices.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        No phone bank slices found for this tag.
      </div>
    );
  }

  const router = useRouter();
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<PendingSliceUndo | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const csvKeySet = useMemo(() => new Set(csvSliceKeys ?? []), [csvSliceKeys]);

  const sliceModels = useMemo(
    () =>
      slices.map((slice) =>
        computeSliceRenderModel(
          slice,
          questionRowsBySlice,
          callerMetricsBySlice,
          surveyScriptProfile,
          syntheticPivotAllowlistByQuestion,
          widePivotHeaderOrderHint,
          verbatimFinalResultLabels
        )
      ),
    [
      slices,
      questionRowsBySlice,
      callerMetricsBySlice,
      surveyScriptProfile,
      syntheticPivotAllowlistByQuestion,
      widePivotHeaderOrderHint,
      verbatimFinalResultLabels,
    ]
  );

  async function removeSliceFromServer(sliceKey: string) {
    if (!tagId) return;
    const hasCsv = csvKeySet.has(sliceKey);
    try {
      if (hasCsv) {
        const res = await fetch("/api/phonebanking/csv-upload", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: tagId, sliceKey }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? res.statusText);
      } else {
        const sl = slices.find((s) => s.sliceKey === sliceKey);
        if (!sl) return;
        const res = await fetch("/api/phonebanking/csv-slice-tombstone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tag: tagId,
            sliceKey,
            campaignName: sl.campaignName,
            isoDate: sl.callDate,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? res.statusText);
      }
      setPendingUndo({ sliceKey, hadCsv: hasCsv });
      setActionMsg(
        hasCsv
          ? "Slice hidden from dashboard and CSV removed from disk."
          : "Slice hidden from dashboard."
      );
      router.refresh();
    } catch (e) {
      setPendingUndo(null);
      setActionMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function undoLastHide() {
    if (!tagId || !pendingUndo) return;
    setUndoBusy(true);
    try {
      await clearTombstonesForTag(tagId, [pendingUndo.sliceKey]);
      setPendingUndo(null);
      setActionMsg(
        pendingUndo.hadCsv
          ? "Visibility restored. Re-import CSV to restore uploaded rows."
          : "Slice restored on dashboard."
      );
      router.refresh();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUndoBusy(false);
    }
  }

  function downloadPivotCsv(tsv: string, filename: string) {
    downloadCsvFile(pivotTsvToCsv(tsv), filename);
  }

  function downloadAllVisiblePivots() {
    const sections = sliceModels
      .filter((m) => m.pivotTsv)
      .map((m) => ({
        campaignName: m.slice.campaignName,
        callDate: m.slice.callDate,
        pivotTsv: m.pivotTsv!,
      }));

    if (!sections.length) {
      setActionMsg("No pivot tables to download.");
      return;
    }

    const csv = buildCombinedPivotTablesCsv(sections);
    downloadCsvFile(csv, pivotExportFilename(exportFilenameDate, sections));
    setActionMsg(
      `Downloaded ${sections.length} pivot table${sections.length === 1 ? "" : "s"} as one CSV.`
    );
  }

  return (
    <div className="space-y-5">
      {actionMsg || pendingUndo ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400 rounded border border-gray-200 dark:border-gray-600 px-2 py-1">
          {actionMsg ? <span>{actionMsg}</span> : null}
          {pendingUndo ? (
            <button
              type="button"
              disabled={undoBusy}
              className="rounded border border-indigo-300 dark:border-indigo-700 px-2 py-0.5 font-medium text-indigo-800 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50"
              onClick={() => void undoLastHide()}
            >
              {undoBusy ? "Undoing…" : "Undo"}
            </button>
          ) : null}
        </div>
      ) : null}
      {sliceModels.some((m) => m.pivotTsv) ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setActionMsg(null);
              downloadAllVisiblePivots();
            }}
            className="dash-action-btn dash-action-btn-md dash-action-btn-download"
          >
            Download all visible pivot tables (CSV)
          </button>
        </div>
      ) : null}
      {sliceModels.map((model) => {
        const {
          slice,
          hrsPerPber,
          callPct,
          secsPerCall,
          rows,
          spanishSlice,
          rowsByPhonebanker,
          sortedPivotQuestionKeys,
          prunedQuestionGroups,
          renderedColumns,
          metricsByBanker,
          sortedBankers,
          hasPivot,
          showTable,
          finalResultRawLines,
          finalResultConsolidated,
          showFinalResultBucketSummary,
          pivotTsv,
        } = model;
        const hasCsvSlice = csvKeySet.has(slice.sliceKey);
        const safeFile = `${slice.campaignName.replace(/[^\w\d-]+/g, "_")}_${slice.callDate}.csv`;

        return (
          <section key={slice.sliceKey} className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
            <div className="border-b border-gray-200 dark:border-gray-700 text-xs bg-gray-50 dark:bg-gray-800">
              <div className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-100">Data</div>
            </div>

            <div className="p-3 space-y-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {slice.campaignName} - {formatShortUsDate(slice.callDate)}
              </div>

              <div className="text-sm">
                <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-2">
                  <div className="flex justify-between"><span>PBers</span><strong>{slice.pbers}</strong></div>
                  <div className="flex justify-between"><span>Time logged in</span><strong>{secToTime(slice.loggedInSeconds)}</strong></div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">({hrsPerPber} hrs/pber)</div>
                  <div className="flex justify-between mt-1"><span>Time in calls</span><strong>{secToTime(slice.callSeconds)}</strong></div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">({callPct} of time logged in)</div>
                  <div className="flex justify-between mt-1"><span>Calls Answered</span><strong>{slice.callsAnswered.toLocaleString()}</strong></div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    (
                    {formatCallsPerLoggedInHour(slice.callsAnswered, slice.loggedInSeconds)} per
                    logged-in hr, {secsPerCall ? `${secsPerCall} secs/call` : "—"})
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-100">
                    Question Responses by Phonebanker
                  </span>
                  {showTable && pivotTsv ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        className="dash-action-btn dash-action-btn-sm dash-action-btn-copy"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(pivotTsv);
                            setActionMsg("Pivot table copied to clipboard (TSV).");
                          } catch {
                            setActionMsg("Clipboard failed — try Download CSV.");
                          }
                        }}
                      >
                        Copy table
                      </button>
                      <button
                        type="button"
                        className="dash-action-btn dash-action-btn-sm dash-action-btn-download"
                        onClick={() => {
                          setActionMsg(null);
                          downloadPivotCsv(pivotTsv, safeFile);
                        }}
                      >
                        Download CSV
                      </button>
                      {tagId && hasCsvSlice ? (
                        <button
                          type="button"
                          className="dash-action-btn dash-action-btn-sm dash-action-btn-delete"
                          onClick={() => {
                            if (
                              !confirm(
                                `Delete saved CSV and hide this slice from the dashboard?\n${slice.campaignName} (${slice.callDate})`
                              )
                            )
                              return;
                            void removeSliceFromServer(slice.sliceKey);
                          }}
                        >
                          Delete
                        </button>
                      ) : null}
                      {tagId && !hasCsvSlice ? (
                        <button
                          type="button"
                          className="dash-action-btn dash-action-btn-sm dash-action-btn-hide"
                          onClick={() => {
                            if (
                              !confirm(
                                `Hide this slice from the dashboard (and block CSV re-import without confirmation)?\n${slice.campaignName} (${slice.callDate})`
                              )
                            )
                              return;
                            void removeSliceFromServer(slice.sliceKey);
                          }}
                        >
                          Hide
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {!showTable ? (
                  <div className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                    No caller or question-response data for this day.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1000px] text-xs border-collapse">
                      <thead>
                        {hasPivot ? (
                          <>
                            <tr className="bg-gray-50 dark:bg-gray-800">
                              <th
                                rowSpan={2}
                                className="sticky left-0 z-20 bg-gray-50 dark:bg-gray-800 text-left px-2 py-1 border border-gray-200 dark:border-gray-700 min-w-[140px]"
                              >
                                Phonebanker
                              </th>
                              <th
                                rowSpan={2}
                                className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap min-w-[88px]"
                              >
                                Hrs logged in
                              </th>
                              <th
                                rowSpan={2}
                                className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap min-w-[88px]"
                              >
                                Time in calls
                              </th>
                              <th
                                rowSpan={2}
                                className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap min-w-[72px]"
                                title="Distinct calls with any non-empty answer on the canvass / contact-quality question."
                              >
                                Calls answered
                              </th>
                              <th
                                rowSpan={2}
                                className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap min-w-[72px]"
                                title="Canvass answers matching correct/right-person wording, excluding obvious negatives (e.g. not the correct person, wrong person)."
                              >
                                Correct person
                              </th>
                              <th
                                rowSpan={2}
                                className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap min-w-[64px]"
                                title="Per campaign: first survey question after canvass (excluding canvass), counting distinct calls whose answer looks like support/yes, undecided/unsure, or oppose/no."
                              >
                                Surveyed
                              </th>
                              {sortedPivotQuestionKeys.map((question) => {
                                const cols = prunedQuestionGroups.get(question) ?? [];
                                return (
                                <th
                                  key={question}
                                  colSpan={cols.length}
                                  className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-normal leading-tight max-w-[220px]"
                                >
                                  {formatSurveyColumnHeader(question, {
                                    spanishSlice,
                                    role: "question",
                                    profile: surveyScriptProfile,
                                  })}
                                </th>
                                );
                              })}
                            </tr>
                            <tr className="bg-gray-50 dark:bg-gray-800">
                              {renderedColumns.map((col) => (
                                <th
                                  key={col.key}
                                  className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 min-w-[90px] font-medium whitespace-normal leading-tight max-w-[200px]"
                                >
                                  {formatSurveyColumnHeader(col.answerValue, {
                                    spanishSlice,
                                    role: "answer",
                                    profile: surveyScriptProfile,
                                  })}
                                </th>
                              ))}
                            </tr>
                          </>
                        ) : (
                          <tr className="bg-gray-50 dark:bg-gray-800">
                            <th className="sticky left-0 z-20 bg-gray-50 dark:bg-gray-800 text-left px-2 py-1 border border-gray-200 dark:border-gray-700 min-w-[140px]">
                              Phonebanker
                            </th>
                            <th className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap">
                              Hrs logged in
                            </th>
                            <th className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap">
                              Time in calls
                            </th>
                            <th
                              className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap"
                              title="Distinct calls with any non-empty answer on the canvass / contact-quality question."
                            >
                              Calls answered
                            </th>
                            <th
                              className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap"
                              title="Canvass answers matching correct/right-person wording, excluding obvious negatives (e.g. not the correct person, wrong person)."
                            >
                              Correct person
                            </th>
                            <th
                              className="text-center px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold whitespace-nowrap"
                              title="Per campaign: first survey question after canvass (excluding canvass), counting distinct calls whose answer looks like support/yes, undecided/unsure, or oppose/no."
                            >
                              Surveyed
                            </th>
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        <tr className="bg-gray-50 dark:bg-gray-800 font-semibold">
                          <td className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-800 px-2 py-1 border border-gray-200 dark:border-gray-700">
                            TOTAL
                          </td>
                          <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-center font-mono">
                            {secToTime(slice.loggedInSeconds)}
                          </td>
                          <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-center font-mono">
                            {secToTime(slice.callSeconds)}
                          </td>
                          <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-center">
                            {slice.callsAnswered.toLocaleString()}
                          </td>
                          <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-center">
                            {slice.talkingToCorrectPerson.toLocaleString()}
                          </td>
                          <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-center">
                            {slice.surveyed.toLocaleString()}
                          </td>
                          {hasPivot &&
                            renderedColumns.map((col) => {
                              const total = rows.reduce((s, r) => {
                                return s + (`${r.questionName}::${r.answerValue}` === col.key ? r.responseCount : 0);
                              }, 0);
                              return (
                                <td key={`total-${col.key}`} className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-center">
                                  {total}
                                </td>
                              );
                            })}
                        </tr>
                        {sortedBankers.map((phonebankerName) => {
                          const m = metricsByBanker.get(phonebankerName);
                          const pRows = rowsByPhonebanker.get(phonebankerName) ?? [];
                          const valMap = new Map<string, number>();
                          for (const row of pRows) {
                            const k = `${row.questionName}::${row.answerValue}`;
                            valMap.set(k, (valMap.get(k) ?? 0) + row.responseCount);
                          }
                          return (
                            <tr key={phonebankerName} className="hover:bg-indigo-50 dark:hover:bg-gray-800">
                              <td className="sticky left-0 z-10 bg-white dark:bg-gray-900 px-2 py-1 border border-gray-100 dark:border-gray-700 font-medium">
                                {phonebankerName}
                              </td>
                              <td className="px-2 py-1 border border-gray-100 dark:border-gray-700 text-center font-mono">
                                {m ? secToTime(m.totalDialerSeconds) : "—"}
                              </td>
                              <td className="px-2 py-1 border border-gray-100 dark:border-gray-700 text-center font-mono">
                                {m ? secToTime(m.totalCallSeconds) : "—"}
                              </td>
                              <td className="px-2 py-1 border border-gray-100 dark:border-gray-700 text-center">
                                {m ? m.callsAnswered.toLocaleString() : "—"}
                              </td>
                              <td className="px-2 py-1 border border-gray-100 dark:border-gray-700 text-center">
                                {m ? m.talkingToCorrectPerson.toLocaleString() : "—"}
                              </td>
                              <td className="px-2 py-1 border border-gray-100 dark:border-gray-700 text-center">
                                {m ? m.surveyed.toLocaleString() : "—"}
                              </td>
                              {hasPivot &&
                                renderedColumns.map((col) => (
                                  <td key={`${phonebankerName}-${col.key}`} className="px-2 py-1 border border-gray-100 dark:border-gray-700 text-center">
                                    {valMap.get(col.key) ?? 0}
                                  </td>
                                ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {showFinalResultBucketSummary ? (
                  <div className="mt-3 rounded-lg border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-950/25 px-3 py-2 text-xs text-gray-800 dark:text-gray-200">
                    <div className="font-semibold text-indigo-900 dark:text-indigo-200">
                      {verbatimFinalResultLabels
                        ? "Final result — script options"
                        : "Final result — dashboard buckets"}
                    </div>
                    <p className="mt-1 text-gray-600 dark:text-gray-400 leading-snug">
                      {verbatimFinalResultLabels ? (
                        <>
                          Totals below use the same Final Result answer labels as in your phone bank data (BigQuery).
                          They should line up with the Final Result columns in the table above.
                        </>
                      ) : (
                        <>
                          Daily Aggregate merges raw STW answers (above) into {finalResultBucketsFootnoteLead}{" "}
                          display groups. Summing pivot columns by eye usually will not match those buckets — use the
                          lines below, or add these counts across phone banks to reconcile a filtered day.
                        </>
                      )}
                    </p>
                    <div className="mt-2 text-gray-600 dark:text-gray-400">
                      {sumAnswerLines(finalResultRawLines).toLocaleString()} responses (raw total = pivot
                      column sums for Final Result)
                    </div>
                    <ul className="mt-1.5 space-y-0.5 list-none">
                      {finalResultConsolidated.map((line) => (
                        <li key={line.label}>
                          <span className="tabular-nums font-medium">{line.count.toLocaleString()}</span>{" "}
                          {line.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
