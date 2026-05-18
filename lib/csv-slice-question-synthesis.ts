/**
 * Build BigQuery-shaped question/answer rows from stored CSV so the Data tab pivot
 * can render for campaign×days that only exist in the CSV store (no STW question stats in BQ).
 */
import { buildWideImportPreview, normalizeWideHeaderKey } from "./pb-wide-report-to-sheet-rows";
import { makeSliceKey, normalizeDateToIso } from "./slice-key";
import type { PhoneBankCsvRow } from "./types";

export type PbQuestionAnswerRowLike = {
  phonebankerName: string;
  questionName: string;
  answerValue: string;
  responseCount: number;
};

/** (field, pivot question, pivot answer label) — only numeric counts > 0 are emitted. Contact metrics are omitted here (shown as fixed columns on the Data tab). */
const CSV_FIELD_PIVOT: Array<[keyof PhoneBankCsvRow, string, string]> = [
  ["pollingFaizah", "Polling", "Faizah"],
  ["pollingUndecidedB", "Polling", "Undecided B"],
  ["pollingUndecided", "Polling", "Undecided"],
  ["pollingTraci", "Polling", "Traci"],
  ["pitchSS", "Faizah pitch", "Strong support"],
  ["pitchUndecidedB", "Faizah pitch", "Undecided B"],
  ["pitchUndecided", "Faizah pitch", "Undecided"],
  ["pitchSO", "Faizah pitch", "Strong oppose"],
  ["pitchHangUp", "Faizah pitch", "Hang up"],
  ["ntpFaizah", "Not Traci Park", "Faizah"],
  ["ntpCommits", "Not Traci Park", "Won't vote Traci"],
  ["ntpUndecided", "Not Traci Park", "Undecided"],
  ["ntpTraciSupporter", "Not Traci Park", "Traci supporter"],
  ["ntpHangUp", "Not Traci Park", "Hang up"],
  ["finalSS", "Final result", "Strong support"],
  ["finalWontVoteTraci", "Final result", "Won't vote Traci"],
  ["finalUndecided", "Final result", "Undecided"],
  ["finalSO", "Final result", "Strong oppose"],
  ["donateNow", "Donate", "Will donate now"],
  ["donateLater", "Donate", "Will donate later"],
  ["donateUndecided", "Donate", "Undecided"],
  ["donateWont", "Donate", "Will not donate"],
  ["disclaimerNo", "Disclaimer", "No"],
  ["disclaimerYes", "Disclaimer", "Yes"],
  ["canvassAMNA", "Canvass non-contact", "AM / no answer"],
  ["canvassAnsweringMachine", "Canvass non-contact", "Answering machine"],
  ["canvassVoicemail", "Canvass non-contact", "Voicemail"],
  ["canvassCallBack", "Canvass non-contact", "Call back"],
  ["canvassDeclined", "Canvass non-contact", "Declined"],
  ["canvassDNC", "Canvass non-contact", "Do not call"],
  ["canvassLangOther", "Canvass non-contact", "Language: other"],
  ["canvassLangSpanish", "Canvass non-contact", "Language: Spanish"],
  ["canvassMoved", "Canvass non-contact", "Moved"],
  ["canvassWrongNumber", "Canvass non-contact", "Wrong number"],
  ["flyerYes", "Flyer", "Yes"],
  ["flyerUnsure", "Flyer", "Unsure"],
  ["flyerNo", "Flyer", "No"],
  ["violationsYes", "Traci violations rap", "Should disqualify"],
  ["violationsUnsure", "Traci violations rap", "Unsure"],
  ["violationsNo", "Traci violations rap", "Should not"],
  ["votePlanA", "Vote plan", "A"],
  ["votePlanB", "Vote plan", "B"],
  ["votePlanC", "Vote plan", "C"],
  ["votePlanD", "Vote plan", "D"],
  ["votePlanE", "Vote plan", "E"],
  ["votePlanF", "Vote plan", "F"],
  ["votePlanG", "Vote plan", "G"],
];

const FIELD_TO_SYNTHETIC_PIVOT = (() => {
  const m = new Map<keyof PhoneBankCsvRow, readonly [string, string]>();
  for (const [field, q, a] of CSV_FIELD_PIVOT) {
    m.set(field, [q, a]);
  }
  return m;
})();

/** All (question, answer) pairs emitted from {@link CSV_FIELD_PIVOT} — used to show zero columns in the Data pivot. */
export function getCsvSyntheticPivotAnswersByQuestion(): ReadonlyMap<string, readonly string[]> {
  const m = new Map<string, string[]>();
  for (const [, q, a] of CSV_FIELD_PIVOT) {
    const arr = m.get(q) ?? [];
    if (!arr.includes(a)) arr.push(a);
    m.set(q, arr);
  }
  return m;
}

/**
 * Which synthetic pivot (question → answer labels) actually appear in this tag's wide PB headers,
 * using the same header→field rules as import. Aligns zero-fill with columns the STW converter emits
 * (only dispositions that occurred in raw data become wide columns).
 */
export function getSyntheticPivotAllowlistFromWideHeaders(
  headers: readonly string[],
  savedHeaderFieldMap?: Record<string, keyof PhoneBankCsvRow> | null
): ReadonlyMap<string, ReadonlySet<string>> {
  const uniq = [...new Set(headers.map((h) => h.trim()).filter(Boolean))];
  if (!uniq.length) return new Map();

  const preview = buildWideImportPreview(uniq, undefined, savedHeaderFieldMap ?? undefined);
  const byQ = new Map<string, Set<string>>();
  for (const m of preview.mappedToSheet) {
    if (!m.sheetField) continue;
    const pair = FIELD_TO_SYNTHETIC_PIVOT.get(m.sheetField);
    if (!pair) continue;
    const [q, a] = pair;
    const s = byQ.get(q) ?? new Set<string>();
    s.add(a);
    byQ.set(q, s);
  }
  return new Map([...byQ.entries()].map(([q, set]) => [q, set as ReadonlySet<string>]));
}

/** Headers shown in the Data pivot — exclude roster / time / contact metrics (fixed columns on the tab). */
export function isWideImportMetaPivotHeader(header: string): boolean {
  const t = header.trim().toLowerCase();
  if (t === "caller name" || t === "date") return true;
  if (/^hours\s+logged\s+in$/i.test(t) || /^hrs\s+logged\s+in$/i.test(t) || /^hours\s+logged$/i.test(t)) return true;
  if (/^time\s+in\s+calls$/i.test(t) || /^call\s*time$/i.test(t)) return true;
  if (/^calls?\s*answered$/i.test(t) || /^answered$/i.test(t)) return true;
  if (/correct\s*person|right\s*person|talking\s*to\s*correct/i.test(t)) return true;
  if (/^surveyed$/i.test(t) || /survey\s*complete|completed\s*survey/i.test(t)) return true;
  return false;
}

/** Ordered list of wide headers to drive pivot columns / zero-fill (matches importer first row). */
export function filterWidePivotImportHeaders(headers: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of headers) {
    const t = raw.trim();
    if (!t || seen.has(t) || isWideImportMetaPivotHeader(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Order pivot question groups like the last imported wide CSV header row. */
export function sortWidePivotQuestionKeysByImportOrder(
  questionKeys: readonly string[],
  orderedHeaders: readonly string[]
): string[] {
  const set = new Set(questionKeys);
  const out: string[] = [];
  for (const h of orderedHeaders) {
    if (set.has(h)) out.push(h);
  }
  const tail = [...questionKeys].filter((k) => !out.includes(k)).sort((a, b) => a.localeCompare(b));
  return [...out, ...tail];
}

const CONTACT_PIVOT_SKIP_FIELDS = new Set<keyof PhoneBankCsvRow>(["callsAnswered", "correctPerson", "surveyed"]);

function readWidePivotCellValue(row: PhoneBankCsvRow, displayHeader: string, normalizedKey: string): number {
  const ex = row.extraWideColumns;
  if (!ex) return 0;
  const direct = ex[displayHeader];
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  for (const [k, v] of Object.entries(ex)) {
    if (normalizeWideHeaderKey(k) === normalizedKey && typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

export type AppendCsvOnlyQuestionRowsOptions = {
  /** Last imported wide CSV header row (order preserved). When set, pivot uses wide column titles + importer order. */
  widePivotHeaders?: readonly string[];
  savedHeaderFieldMap?: Record<string, keyof PhoneBankCsvRow> | null;
};

/**
 * Append synthetic question rows for slices that have no BigQuery daily data, so PbDashboardStack
 * can render the survey pivot from CSV counts alone.
 */
export function appendCsvOnlyQuestionRowsForPbDashboard(
  questionRowsBySlice: Record<string, PbQuestionAnswerRowLike[]>,
  csvRows: readonly PhoneBankCsvRow[],
  bqSliceKeys: Set<string>,
  opts?: AppendCsvOnlyQuestionRowsOptions
): void {
  const wideHeaders = opts?.widePivotHeaders?.filter((h) => h.trim()).length
    ? filterWidePivotImportHeaders(opts.widePivotHeaders)
    : null;
  const savedMap = opts?.savedHeaderFieldMap ?? undefined;

  let headerToField: Map<string, keyof PhoneBankCsvRow> | null = null;
  if (wideHeaders?.length) {
    const uniq = [...new Set(wideHeaders.map((h) => h.trim()))];
    const preview = buildWideImportPreview(uniq, undefined, savedMap ?? undefined);
    headerToField = new Map();
    for (const it of preview.items) {
      const nk = normalizeWideHeaderKey(it.header);
      if (it.sheetField) headerToField.set(nk, it.sheetField);
    }
  }

  const wideSeen = wideHeaders ? new Set(wideHeaders.map((h) => h.trim())) : null;
  const wideSeenNk =
    wideHeaders && wideHeaders.length > 0
      ? new Set(wideHeaders.map((h) => normalizeWideHeaderKey(h.trim())))
      : null;

  for (const row of csvRows) {
    const iso = normalizeDateToIso(row.date);
    if (!iso) continue;
    const sk = makeSliceKey(row.phoneBankName, iso);
    if (bqSliceKeys.has(sk)) continue;

    const banker = (row.callerNameRaw?.trim() || row.callerName).trim();
    if (!banker) continue;

    const bucket = questionRowsBySlice[sk] ?? [];
    questionRowsBySlice[sk] = bucket;

    if (wideHeaders?.length) {
      for (const h of wideHeaders) {
        const nk = normalizeWideHeaderKey(h);
        const field = headerToField?.get(nk);
        if (field && CONTACT_PIVOT_SKIP_FIELDS.has(field)) continue;

        /** Only per-header {@link PhoneBankCsvRow.extraWideColumns} counts — never fall back to `row[field]`, which sums every wide column mapped to that field (e.g. 05 Anti Traci + 06 Final Result). */
        const v = readWidePivotCellValue(row, h, nk);
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
        bucket.push({
          phonebankerName: banker,
          questionName: h,
          answerValue: "",
          responseCount: v,
        });
      }

      const extras = row.extraWideColumns;
      if (extras) {
        for (const [header, count] of Object.entries(extras)) {
          if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
          const ht = header.trim();
          if (wideSeen?.has(ht)) continue;
          if (wideSeenNk?.has(normalizeWideHeaderKey(header))) continue;
          bucket.push({
            phonebankerName: banker,
            questionName: header,
            answerValue: "",
            responseCount: count,
          });
        }
      }
      continue;
    }

    for (const [key, questionName, answerValue] of CSV_FIELD_PIVOT) {
      const v = row[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      bucket.push({
        phonebankerName: banker,
        questionName,
        answerValue,
        responseCount: v,
      });
    }

    const extras = row.extraWideColumns;
    if (!extras) continue;
    for (const [header, count] of Object.entries(extras)) {
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      const ht = header.trim();
      const prevOne = buildWideImportPreview([ht], undefined, savedMap ?? undefined);
      const mappedField = prevOne.mappedToSheet.find(
        (x) => normalizeWideHeaderKey(x.header) === normalizeWideHeaderKey(ht)
      )?.sheetField;
      if (mappedField && FIELD_TO_SYNTHETIC_PIVOT.has(mappedField)) continue;

      bucket.push({
        phonebankerName: banker,
        questionName: header,
        answerValue: "",
        responseCount: count,
      });
    }
  }
}
