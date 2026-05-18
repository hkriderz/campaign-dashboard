/**
 * Scale to Win raw export → wide PB crosstab report (TypeScript port of the Colab script).
 *
 * Pipeline: UTC timestamps → local calendar date → prefix answer cells → per-day crosstabs + outer merges.
 */
import { DateTime } from "luxon";
import { tokenizeCsvLine } from "./csv-parser";

function scriptSortKey(header: string): { section: number; letter: number } {
  const trimmed = header.trim();
  const mNum = /^(\d+)\s/.exec(trimmed);
  const section = mNum ? parseInt(mNum[1]!, 10) : 10_000;
  const mLet = /:\s*([A-Za-z])\./.exec(trimmed);
  const letter = mLet ? mLet[1]!.toUpperCase().charCodeAt(0) - 64 : 99;
  return { section, letter };
}

export type StwConvertOptions = {
  /** IANA zone, e.g. US/Pacific */
  timezone?: string;
  callDatetimeCol?: string;
  callerCol?: string;
  canvassCol?: string;
};

const DEFAULTS = {
  timezone: "US/Pacific",
  callDatetimeCol: "Call Date/Time",
  callerCol: "Caller Name",
  canvassCol: "Canvass Result",
} as const;

export function parseRawCsvToMatrix(csvText: string): { headers: string[]; rows: string[][] } {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = tokenizeCsvLine(lines[0]!).map((h) => h.trim());
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(tokenizeCsvLine(lines[i]!));
  }
  return { headers, rows };
}

function colIndex(headers: string[], name: string): number {
  const i = headers.indexOf(name);
  if (i < 0) throw new Error(`Missing column "${name}". Found: ${headers.join(", ")}`);
  return i;
}

function parseUtcToLocalIsoDate(raw: string, zone: string): string {
  const s = raw.trim();
  let dt = DateTime.fromISO(s, { zone: "utc" });
  if (!dt.isValid) {
    const js = new Date(s);
    if (!Number.isNaN(js.getTime())) {
      dt = DateTime.fromJSDate(js, { zone: "utc" });
    }
  }
  if (!dt.isValid) {
    dt = DateTime.fromSQL(s, { zone: "utc" });
  }
  if (!dt.isValid) {
    throw new Error(`Invalid datetime cell: ${JSON.stringify(raw)}`);
  }
  const local = dt.setZone(zone);
  const d = local.toISODate();
  if (!d) throw new Error(`Could not derive local date for: ${JSON.stringify(raw)}`);
  return d;
}

/** One object per raw row, keyed by header name. */
function rowsToRecords(headers: string[], rows: string[][]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const r of rows) {
    const o: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      o[headers[c]!] = (r[c] ?? "").trim();
    }
    out.push(o);
  }
  return out;
}

function prefixColumnsInRange(
  records: Record<string, string>[],
  orderedKeys: string[],
  columnIndex: number,
  lastCol: number
): void {
  for (let i = columnIndex; i < lastCol; i++) {
    const key = orderedKeys[i]!;
    for (const rec of records) {
      const v = rec[key];
      if (v == null || v === "") continue;
      rec[key] = `${key}: ${v}`;
    }
  }
}

type WideRow = Record<string, string | number>;

function crosstabCounts(
  recs: Record<string, string>[],
  rowKey: string,
  colKey: string
): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const r of recs) {
    const rowv = (r[rowKey] ?? "").trim();
    if (!rowv) continue;
    const colv = (r[colKey] ?? "").trim();
    if (!m.has(rowv)) m.set(rowv, new Map());
    const inner = m.get(rowv)!;
    inner.set(colv, (inner.get(colv) ?? 0) + 1);
  }
  return m;
}

function crosstabToWideRows(
  callerCol: string,
  ct: Map<string, Map<string, number>>
): WideRow[] {
  const colLabels = new Set<string>();
  for (const inner of ct.values()) {
    for (const k of inner.keys()) colLabels.add(k);
  }
  const sortedCols = [...colLabels].sort((a, b) => {
    const sa = scriptSortKey(a);
    const sb = scriptSortKey(b);
    if (sa.section !== sb.section) return sa.section - sb.section;
    if (sa.letter !== sb.letter) return sa.letter - sb.letter;
    return a.localeCompare(b);
  });
  const callers = [...ct.keys()].sort((a, b) => a.localeCompare(b));
  return callers.map((caller) => {
    const row: WideRow = { [callerCol]: caller };
    const inner = ct.get(caller)!;
    for (const c of sortedCols) {
      row[c] = inner.get(c) ?? 0;
    }
    return row;
  });
}

function outerMergeWideRows(a: WideRow[], b: WideRow[], onKey: string): WideRow[] {
  const map = new Map<string, WideRow>();
  for (const r of a) {
    const k = String(r[onKey]);
    map.set(k, { ...r });
  }
  for (const r of b) {
    const k = String(r[onKey]);
    const prev = map.get(k) ?? { [onKey]: k };
    map.set(k, { ...prev, ...r });
  }
  return [...map.values()].sort((x, y) =>
    String(x[onKey]).localeCompare(String(y[onKey]))
  );
}

function stringifyCsvField(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function wideRowsToCsv(rows: WideRow[], orderedColumns: string[]): string {
  const header = orderedColumns.map(stringifyCsvField).join(",");
  const lines = [header];
  for (const r of rows) {
    lines.push(orderedColumns.map((c) => stringifyCsvField(r[c] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Convert raw STW CSV text to wide PB report CSV text + column list (sorted like the Python script).
 *
 * `datesIso` lists only calendar days that appear on at least one wide row. Raw calls can fall on
 * additional local calendar days that produce no wide rows (e.g. no caller name); those days are
 * omitted so import checkboxes stay aligned with the wide `Date` column.
 */
export function convertStwRawToPbReport(
  csvText: string,
  options: StwConvertOptions = {}
): {
  wideCsv: string;
  columns: string[];
  rowCount: number;
  datesIso: string[];
  /** Wide rows per ISO date (same keys as {@link datesIso}). */
  dateRowCounts: Record<string, number>;
} {
  const timezone = options.timezone ?? DEFAULTS.timezone;
  const callDatetimeCol = options.callDatetimeCol ?? DEFAULTS.callDatetimeCol;
  const callerCol = options.callerCol ?? DEFAULTS.callerCol;
  const canvassCol = options.canvassCol ?? DEFAULTS.canvassCol;

  const { headers, rows } = parseRawCsvToMatrix(csvText);
  if (!headers.length) {
    return { wideCsv: "", columns: [], rowCount: 0, datesIso: [], dateRowCounts: {} };
  }

  const iCall = colIndex(headers, callDatetimeCol);
  const iCaller = colIndex(headers, callerCol);
  const iCanvass = colIndex(headers, canvassCol);

  const orderedKeys = [...headers];
  const records = rowsToRecords(headers, rows);

  for (const rec of records) {
    const rawDt = rec[callDatetimeCol] ?? "";
    rec["Date"] = parseUtcToLocalIsoDate(rawDt, timezone);
    delete rec[callDatetimeCol];
  }

  const newOrder = orderedKeys.filter((k) => k !== callDatetimeCol);
  newOrder.push("Date");

  const columnIndex = newOrder.indexOf(canvassCol);
  if (columnIndex < 0) throw new Error(`Canvass column not in frame: ${canvassCol}`);
  const lastCol = newOrder.length - 1;

  prefixColumnsInRange(records, newOrder, columnIndex, lastCol);

  /** Every calendar day seen on raw rows (used to build per-day crosstabs). */
  const calendarDays = [...new Set(records.map((r) => r["Date"] ?? "").filter(Boolean))].sort();
  const allSummaries: WideRow[] = [];

  for (const d of calendarDays) {
    const dateframe = records.filter((r) => r["Date"] === d);
    const ct0 = crosstabCounts(dateframe, callerCol, canvassCol);
    let dtSummary = crosstabToWideRows(callerCol, ct0);

    for (let col = columnIndex; col < lastCol - 1; col++) {
      const colName = newOrder[col + 1]!;
      const cti = crosstabCounts(dateframe, callerCol, colName);
      const part = crosstabToWideRows(callerCol, cti);
      dtSummary = outerMergeWideRows(dtSummary, part, callerCol);
    }

    for (const row of dtSummary) {
      row["Date"] = d;
    }
    allSummaries.push(...dtSummary);
  }

  /** ISO days that actually appear on wide rows (some raw-only calendar days produce zero wide rows). */
  const datesIso = [...new Set(allSummaries.map((r) => String(r["Date"] ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const dateRowCounts: Record<string, number> = {};
  for (const r of allSummaries) {
    const d = String(r["Date"] ?? "").trim();
    if (!d) continue;
    dateRowCounts[d] = (dateRowCounts[d] ?? 0) + 1;
  }

  const columnsDiscovered: string[] = [];
  const seenCol = new Set<string>();
  for (const r of allSummaries) {
    for (const k of Object.keys(r)) {
      if (seenCol.has(k)) continue;
      seenCol.add(k);
      columnsDiscovered.push(k);
    }
  }
  const rest = columnsDiscovered.filter((k) => k !== callerCol && k !== "Date");
  const columns = [callerCol, "Date", ...rest];
  const wideCsv = wideRowsToCsv(allSummaries, columns);

  return {
    wideCsv,
    columns,
    rowCount: allSummaries.length,
    datesIso,
    dateRowCounts,
  };
}
