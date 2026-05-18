/**
 * Canonical column order for wide PB crosstab CSVs (Scale-to-Win → dashboard store).
 *
 * Leading columns align with roster-style exports: caller, date, two time fields, three contact
 * metrics, then script / rollup columns ordered by script number + option letter, with BQ-style
 * field order for dashboard rollups and saved extra-column hints for tie-breaks.
 */
import { buildWideImportPreview, WIDE_NUMERIC_FIELD_ORDER } from "./pb-wide-report-to-sheet-rows";
import { parseRawCsvToMatrix, wideRowsToCsv } from "./stw-raw-to-pb-report";
import type { PhoneBankCsvRow } from "./types";

export const WIDE_CANONICAL_HOURS_HEADER = "Hours logged in";
export const WIDE_CANONICAL_TIME_IN_CALLS_HEADER = "Time in calls";

const CALLER = "Caller Name";
const DATE = "Date";

/** Wide crosstab column from STW canvass dispositions (always last in natural order). */
export function isCanvassWideHeader(header: string): boolean {
  return /^canvass\s+result\s*:/i.test(header.trim());
}

/** Raw STW question column name from a wide header like `01 Faizah Ask: A. …`. */
export function rawScriptColumnFromWideHeader(header: string): string | null {
  const m = /^(\d+\s[^:]+):/.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

function isHoursHeader(h: string): boolean {
  const t = h.trim().toLowerCase();
  return /^hours\s+logged\s+in$/i.test(t) || /^hrs\s+logged\s+in$/i.test(t) || /^hours\s+logged$/i.test(t);
}

function isTimeInCallsHeader(h: string): boolean {
  const t = h.trim().toLowerCase();
  return /^time\s+in\s+calls$/i.test(t) || /^call\s*time$/i.test(t);
}

/** Script-style headers: "03 Polling: A. …" → section + option for sorting. */
export function parseWideScriptSortKey(header: string): { section: number; letter: number } {
  const trimmed = header.trim();
  const mNum = /^(\d+)\s/.exec(trimmed);
  const section = mNum ? parseInt(mNum[1]!, 10) : 10_000;
  const mLet = /:\s*([A-Za-z])\./.exec(trimmed);
  const letter = mLet ? mLet[1]!.toUpperCase().charCodeAt(0) - 64 : 99;
  return { section, letter };
}

function refRankMap(hint: readonly string[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!hint?.length) return m;
  hint.forEach((h, i) => {
    const k = h.trim();
    if (!m.has(k)) m.set(k, i);
  });
  return m;
}

function compareScriptHeaders(a: string, b: string, refRank: Map<string, number>): number {
  const sa = parseWideScriptSortKey(a);
  const sb = parseWideScriptSortKey(b);
  if (sa.section !== sb.section) return sa.section - sb.section;
  if (sa.letter !== sb.letter) return sa.letter - sb.letter;
  const ra = refRank.get(a.trim()) ?? 9999;
  const rb = refRank.get(b.trim()) ?? 9999;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}

export type ComputeWideColumnOrderOptions = {
  referenceHeaders?: readonly string[];
  savedHeaderFieldMap?: Record<string, keyof PhoneBankCsvRow> | null;
  /** Per-tag stable order for unmapped script columns (first-seen from prior imports). */
  extraColumnHintOrder?: readonly string[];
};

export type StwWideColumnOrderOptions = {
  callerCol?: string;
  callDatetimeCol?: string;
  canvassCol?: string;
};

/**
 * Natural STW wide order: lead columns, optional Hours/Time slots, script columns in **raw file**
 * column order (answers within each question by script number + letter), **canvass last**.
 */
export function computeStwWideColumnOrder(
  rawStwHeaders: readonly string[],
  wideHeaders: readonly string[],
  opts?: StwWideColumnOrderOptions
): string[] {
  const callerCol = opts?.callerCol?.trim() || CALLER;
  const callDatetimeCol = opts?.callDatetimeCol?.trim() || "Call Date/Time";
  const canvassCol = opts?.canvassCol?.trim() || "Canvass Result";

  const wideUnique = [...new Set(wideHeaders.map((h) => h.trim()).filter(Boolean))];
  const wideSet = new Set(wideUnique);

  const scriptRawCols = rawStwHeaders
    .map((h) => h.trim())
    .filter((h) => {
      if (!h) return false;
      if (h === callerCol || h === callDatetimeCol || h === canvassCol) return false;
      if (isHoursHeader(h) || isTimeInCallsHeader(h)) return false;
      return true;
    });

  const used = new Set<string>();
  const middle: string[] = [];
  const canvass: string[] = [];

  for (const h of wideUnique) {
    if (h === callerCol || h === DATE) {
      used.add(h);
      continue;
    }
    if (isCanvassWideHeader(h)) {
      canvass.push(h);
      used.add(h);
    }
  }

  for (const rawCol of scriptRawCols) {
    const group: string[] = [];
    for (const h of wideUnique) {
      if (used.has(h) || isCanvassWideHeader(h)) continue;
      const prefix = rawScriptColumnFromWideHeader(h);
      if (prefix === rawCol || h.startsWith(`${rawCol}:`)) {
        group.push(h);
        used.add(h);
      }
    }
    group.sort((a, b) => compareScriptHeaders(a, b, new Map()));
    middle.push(...group);
  }

  const leftovers: string[] = [];
  for (const h of wideUnique) {
    if (!used.has(h) && !isCanvassWideHeader(h)) leftovers.push(h);
  }
  leftovers.sort((a, b) => compareScriptHeaders(a, b, new Map()));
  middle.push(...leftovers);

  canvass.sort((a, b) => a.localeCompare(b));

  const out: string[] = [];
  const pushLead = (h: string) => {
    const t = h.trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };

  pushLead(callerCol);
  pushLead(DATE);
  if (wideSet.has(WIDE_CANONICAL_HOURS_HEADER) || !wideUnique.some(isHoursHeader)) {
    pushLead(WIDE_CANONICAL_HOURS_HEADER);
  }
  if (wideSet.has(WIDE_CANONICAL_TIME_IN_CALLS_HEADER) || !wideUnique.some(isTimeInCallsHeader)) {
    pushLead(WIDE_CANONICAL_TIME_IN_CALLS_HEADER);
  }

  for (const h of middle) pushLead(h);
  for (const h of canvass) pushLead(h);

  for (const h of wideUnique) {
    if (!out.includes(h)) out.push(h);
  }

  return out;
}

/** Rank for ordering pivot question names against a saved wide import header row. */
export function wideHeaderOrderRankForQuestion(
  orderedHeaders: readonly string[],
  questionName: string
): number {
  const q = questionName.trim();
  let best = 1e9;
  for (let i = 0; i < orderedHeaders.length; i++) {
    const h = orderedHeaders[i]!.trim();
    if (!h) continue;
    if (h === q) return i;
    if (h.startsWith(`${q}:`)) best = Math.min(best, i);
    const prefix = rawScriptColumnFromWideHeader(h);
    if (prefix === q) best = Math.min(best, i);
    if (isCanvassWideHeader(h) && /^canvass/i.test(q)) best = Math.min(best, i);
  }
  return best;
}

export function sortPivotQuestionsByWideHeaderHint(
  questionKeys: readonly string[],
  orderedHeaders: readonly string[],
  compareFallback: (a: string, b: string) => number
): string[] {
  const keys = [...questionKeys];
  keys.sort((a, b) => {
    const ra = wideHeaderOrderRankForQuestion(orderedHeaders, a);
    const rb = wideHeaderOrderRankForQuestion(orderedHeaders, b);
    if (ra !== rb) return ra - rb;
    return compareFallback(a, b);
  });
  return keys;
}

/**
 * Full header row for a wide PB CSV: Caller Name, Date, two time columns (zeros for STW),
 * calls answered → correct person → surveyed, remaining rollups in {@link WIDE_NUMERIC_FIELD_ORDER},
 * then unmapped script columns.
 */
export function computeCanonicalWideColumnOrder(
  headersFromCsv: readonly string[],
  opts?: ComputeWideColumnOrderOptions
): string[] {
  const unique = [...new Set(headersFromCsv.map((h) => h.trim()).filter(Boolean))];
  const preview = buildWideImportPreview(
    unique,
    opts?.referenceHeaders ? [...opts.referenceHeaders] : undefined,
    opts?.savedHeaderFieldMap ?? undefined
  );
  const refRank = refRankMap(opts?.extraColumnHintOrder);

  const byField = new Map<keyof PhoneBankCsvRow, string[]>();
  for (const m of preview.mappedToSheet) {
    if (!m.sheetField) continue;
    const arr = byField.get(m.sheetField) ?? [];
    arr.push(m.header);
    byField.set(m.sheetField, arr);
  }
  for (const [k, arr] of byField) {
    arr.sort((a, b) => compareScriptHeaders(a, b, refRank));
    byField.set(k, arr);
  }

  const used = new Set<string>([
    CALLER,
    DATE,
    WIDE_CANONICAL_HOURS_HEADER,
    WIDE_CANONICAL_TIME_IN_CALLS_HEADER,
  ]);
  const out: string[] = [CALLER, DATE, WIDE_CANONICAL_HOURS_HEADER, WIDE_CANONICAL_TIME_IN_CALLS_HEADER];

  const pushUnique = (list: string[], h: string) => {
    const t = h.trim();
    if (!t || used.has(t)) return;
    used.add(t);
    list.push(t);
  };

  const contact: (keyof PhoneBankCsvRow)[] = ["callsAnswered", "correctPerson", "surveyed"];
  for (const field of contact) {
    for (const h of byField.get(field) ?? []) pushUnique(out, h);
  }

  const contactKeys = new Set<keyof PhoneBankCsvRow>(["callsAnswered", "correctPerson", "surveyed"]);
  const canvassFields = new Set<keyof PhoneBankCsvRow>(
    (WIDE_NUMERIC_FIELD_ORDER as readonly (keyof PhoneBankCsvRow)[]).filter((f) =>
      String(f).startsWith("canvass")
    )
  );

  for (const field of WIDE_NUMERIC_FIELD_ORDER) {
    if (contactKeys.has(field) || canvassFields.has(field)) continue;
    for (const h of byField.get(field) ?? []) pushUnique(out, h);
  }

  const extras = preview.storedAsExtra.map((x) => x.header).sort((a, b) => compareScriptHeaders(a, b, refRank));
  for (const h of extras) pushUnique(out, h);

  for (const field of WIDE_NUMERIC_FIELD_ORDER) {
    if (!canvassFields.has(field)) continue;
    for (const h of byField.get(field) ?? []) pushUnique(out, h);
  }

  return out;
}

/**
 * Re-serialize wide CSV so columns match `columnOrder`. Injects time columns when missing.
 * Unknown headers in `columnOrder` are skipped if not present in the source (no blank columns).
 */
export function applyWideColumnOrderToCsvText(wideCsvText: string, columnOrder: readonly string[]): string {
  const { headers, rows } = parseRawCsvToMatrix(wideCsvText);
  if (!headers.length || !columnOrder.length) return wideCsvText;

  const idx = new Map<string, number>();
  headers.forEach((h, i) => {
    idx.set(h.trim(), i);
  });

  /** Map canonical time slot → source column index if any alias exists in file */
  let iHours = headers.findIndex((h) => isHoursHeader(h));
  let iTime = headers.findIndex((h) => isTimeInCallsHeader(h));

  const ordered = columnOrder.map((c) => c.trim()).filter(Boolean);
  const wideRows: Record<string, string | number>[] = [];

  for (const r of rows) {
    const row: Record<string, string | number> = {};
    for (const col of ordered) {
      let j = idx.get(col);
      if (col === WIDE_CANONICAL_HOURS_HEADER && j === undefined && iHours >= 0) j = iHours;
      if (col === WIDE_CANONICAL_TIME_IN_CALLS_HEADER && j === undefined && iTime >= 0) j = iTime;

      if (j !== undefined && j >= 0) {
        row[col] = (r[j] ?? "").trim();
      } else if (col === WIDE_CANONICAL_HOURS_HEADER || col === WIDE_CANONICAL_TIME_IN_CALLS_HEADER) {
        row[col] = "0:00:00";
      } else {
        row[col] = "";
      }
    }
    wideRows.push(row);
  }

  return wideRowsToCsv(wideRows, [...ordered]);
}

export function parseWideColumnOrderJson(raw: string | null | undefined): string[] | null {
  if (raw == null || !String(raw).trim()) return null;
  try {
    const v = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(v)) return null;
    const out = v.map((x) => String(x).trim()).filter(Boolean);
    return out.length ? out : null;
  } catch {
    return null;
  }
}
