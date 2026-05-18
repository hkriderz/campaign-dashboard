/**
 * Simple file-based store for uploaded phone bank CSV data.
 * Saves parsed rows as a JSON file in /data/ at the project root.
 * This runs server-side only — never import from client components.
 */
import fs from "fs";
import path from "path";
import type { PhoneBankCsvRow } from "./types";
import { formatShortUsDate, makeSliceKey, normalizeDateToIso } from "./slice-key";
import {
  isSliceTombstoned,
  removeTombstone,
} from "./csv-slice-tombstones";

const DATA_DIR = path.join(process.cwd(), "data");

type CsvMemoryEntry = { filePath: string; mtimeMs: number; rows: PhoneBankCsvRow[] };
const csvLoadMemoryCache = new Map<string, CsvMemoryEntry>();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(tag: string): string {
  // Sanitize tag to prevent path traversal
  const safe = tag.replace(/[^a-z0-9_-]/gi, "");
  return path.join(DATA_DIR, `phonebanking-csv-${safe}.json`);
}

export function saveCsvData(tag: string, rows: PhoneBankCsvRow[]): void {
  ensureDataDir();
  csvLoadMemoryCache.delete(tag);
  fs.writeFileSync(filePath(tag), JSON.stringify(rows, null, 2), "utf-8");
}

export function loadCsvData(tag: string): PhoneBankCsvRow[] | null {
  const fp = filePath(tag);
  if (!fs.existsSync(fp)) return null;
  try {
    const st = fs.statSync(fp);
    const hit = csvLoadMemoryCache.get(tag);
    if (hit && hit.filePath === fp && hit.mtimeMs === st.mtimeMs) {
      return hit.rows;
    }
    const rows = JSON.parse(fs.readFileSync(fp, "utf-8")) as PhoneBankCsvRow[];
    csvLoadMemoryCache.set(tag, { filePath: fp, mtimeMs: st.mtimeMs, rows });
    return rows;
  } catch {
    return null;
  }
}

export function hasCsvData(tag: string): boolean {
  return fs.existsSync(filePath(tag));
}

export function getCsvUploadedAt(tag: string): string | null {
  const fp = filePath(tag);
  if (!fs.existsSync(fp)) return null;
  try {
    return new Date(fs.statSync(fp).mtime).toLocaleString();
  } catch {
    return null;
  }
}

export function rowSliceKey(row: PhoneBankCsvRow): string | null {
  const isoDate = normalizeDateToIso(row.date);
  if (!isoDate) return null;
  return makeSliceKey(row.phoneBankName, isoDate);
}

export function getSliceKeysForRows(rows: PhoneBankCsvRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = rowSliceKey(row);
    if (key) keys.add(key);
  }
  return keys;
}

export function getCsvSliceKeys(tag: string): Set<string> {
  const rows = loadCsvData(tag) ?? [];
  return getSliceKeysForRows(rows);
}

export function groupRowsBySliceKey(rows: PhoneBankCsvRow[]): Map<string, PhoneBankCsvRow[]> {
  const m = new Map<string, PhoneBankCsvRow[]>();
  for (const row of rows) {
    const k = rowSliceKey(row);
    if (!k) continue;
    const arr = m.get(k) ?? [];
    arr.push(row);
    m.set(k, arr);
  }
  return m;
}

export type CsvSliceSummary = {
  sliceKey: string;
  rowCount: number;
  phoneBankName: string;
  isoDate: string;
};

export function listCsvSlices(tag: string): CsvSliceSummary[] {
  const rows = loadCsvData(tag) ?? [];
  const groups = groupRowsBySliceKey(rows);
  const out: CsvSliceSummary[] = [];
  for (const [sliceKey, g] of groups.entries()) {
    const first = g[0];
    if (!first) continue;
    const iso = normalizeDateToIso(first.date) ?? "";
    out.push({
      sliceKey,
      rowCount: g.length,
      phoneBankName: first.phoneBankName,
      isoDate: iso,
    });
  }
  out.sort(
    (a, b) =>
      b.isoDate.localeCompare(a.isoDate) ||
      a.phoneBankName.localeCompare(b.phoneBankName)
  );
  return out;
}

export function getRowsForSlice(tag: string, sliceKey: string): PhoneBankCsvRow[] {
  const rows = loadCsvData(tag) ?? [];
  return rows.filter((r) => rowSliceKey(r) === sliceKey);
}

export function removeSliceRows(tag: string, sliceKey: string): number {
  const rows = loadCsvData(tag) ?? [];
  const next = rows.filter((r) => rowSliceKey(r) !== sliceKey);
  const removed = rows.length - next.length;
  if (removed > 0) saveCsvData(tag, next);
  return removed;
}

export type CsvFocus = "general" | "gotv" | "violation";

function focusSuffix(focus: CsvFocus): string {
  if (focus === "gotv") return " — GOTV";
  if (focus === "violation") return " — Violation";
  return "";
}

export function applyCsvRowTransforms(
  rows: PhoneBankCsvRow[],
  opts: { targetIsoDate?: string | null; focus: CsvFocus }
): PhoneBankCsvRow[] {
  const suf = focusSuffix(opts.focus);
  const iso = opts.targetIsoDate?.trim();
  const dateOut =
    iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatShortUsDate(iso) : null;

  return rows.map((r) => {
    let phoneBankName = r.phoneBankName;
    if (suf && !phoneBankName.endsWith(suf)) {
      phoneBankName = `${phoneBankName}${suf}`;
    }
    const date = dateOut ?? r.date;
    return { ...r, phoneBankName, date };
  });
}

/**
 * Keep only rows whose {@link PhoneBankCsvRow.date} maps to an ISO calendar day in {@link includedIsoDates}.
 * When {@link includedIsoDates} is `undefined`, returns {@link rows} unchanged (no filter).
 * When provided (including empty), only valid `YYYY-MM-DD` entries are used; empty usable set → no rows pass.
 */
export function filterIncomingRowsByIncludedIsoDates(
  rows: PhoneBankCsvRow[],
  includedIsoDates: string[] | undefined
): PhoneBankCsvRow[] {
  if (includedIsoDates === undefined) return rows;
  const allowed = new Set(
    includedIsoDates
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
  );
  if (allowed.size === 0) return [];
  return rows.filter((r) => {
    const iso = normalizeDateToIso(r.date);
    return iso !== null && allowed.has(iso);
  });
}

function nextDistinctPhoneBankName(
  baseName: string,
  isoDate: string,
  reserved: Set<string>
): string {
  const baseKey = makeSliceKey(baseName, isoDate);
  if (!reserved.has(baseKey)) return baseName;
  for (let n = 2; n < 500; n++) {
    const name = `${baseName} (${n})`;
    const k = makeSliceKey(name, isoDate);
    if (!reserved.has(k)) return name;
  }
  return `${baseName} (${Date.now()})`;
}

export class CsvMergeTombstoneError extends Error {
  readonly code = "TOMBSTONE_CONFLICT" as const;
  constructor(public readonly sliceKeys: string[]) {
    super(
      `These phone bank slices were previously removed from CSV and need confirmation before re-importing: ${sliceKeys.join("; ")}`
    );
    this.name = "CsvMergeTombstoneError";
  }
}

export type MergeCsvUploadResult = {
  rowCount: number;
  sliceCount: number;
  addedSlices: string[];
  replacedSlices: string[];
  bumpedSlices: { from: string; to: string }[];
};

export function mergeCsvUpload(params: {
  tag: string;
  incomingRows: PhoneBankCsvRow[];
  mode: "add" | "replace";
  replaceSliceKey?: string | null;
  targetIsoDate?: string | null;
  focus: CsvFocus;
  acknowledgeTombstone?: boolean;
}): MergeCsvUploadResult {
  const {
    tag,
    incomingRows,
    mode,
    replaceSliceKey,
    targetIsoDate,
    focus,
    acknowledgeTombstone,
  } = params;

  if (mode === "replace") {
    const rk = replaceSliceKey?.trim();
    if (!rk) {
      throw new Error("replaceSliceKey is required when mode is replace");
    }
    const oldRows = getRowsForSlice(tag, rk);
    if (!oldRows.length) {
      throw new Error("No saved CSV data for the selected phone bank slice.");
    }
    const head = oldRows[0]!;
    const rewritten = incomingRows.map((r) => ({
      ...r,
      phoneBankName: head.phoneBankName,
      date: head.date,
    }));
    const existing = (loadCsvData(tag) ?? []).filter((r) => rowSliceKey(r) !== rk);
    const merged = [...existing, ...rewritten];
    saveCsvData(tag, merged);
    const keys = getSliceKeysForRows(merged);
    return {
      rowCount: merged.length,
      sliceCount: keys.size,
      addedSlices: [],
      replacedSlices: [rk],
      bumpedSlices: [],
    };
  }

  let rows = applyCsvRowTransforms(incomingRows, { targetIsoDate, focus });
  const incomingBySlice = groupRowsBySliceKey(rows);
  if (incomingBySlice.size === 0) {
    throw new Error("No valid slice keys in CSV after date/focus adjustments.");
  }

  const tombstoneConflicts: string[] = [];
  for (const k of incomingBySlice.keys()) {
    if (isSliceTombstoned(tag, k)) tombstoneConflicts.push(k);
  }
  if (tombstoneConflicts.length > 0 && !acknowledgeTombstone) {
    throw new CsvMergeTombstoneError(tombstoneConflicts);
  }
  if (acknowledgeTombstone && tombstoneConflicts.length > 0) {
    for (const k of tombstoneConflicts) {
      removeTombstone(tag, k);
    }
  }

  const existingRows = loadCsvData(tag) ?? [];
  const reserved = getSliceKeysForRows(existingRows);
  const bumpedSlices: { from: string; to: string }[] = [];
  const flatOut: PhoneBankCsvRow[] = [];

  for (const [origKey, groupRows] of incomingBySlice.entries()) {
    const first = groupRows[0];
    if (!first) continue;
    const iso = normalizeDateToIso(first.date);
    if (!iso) continue;

    if (reserved.has(origKey)) {
      const newName = nextDistinctPhoneBankName(first.phoneBankName, iso, reserved);
      const newKey = makeSliceKey(newName, iso);
      reserved.add(newKey);
      bumpedSlices.push({ from: origKey, to: newKey });
      for (const r of groupRows) {
        flatOut.push({ ...r, phoneBankName: newName, date: formatShortUsDate(iso) });
      }
    } else {
      reserved.add(origKey);
      flatOut.push(...groupRows);
    }
  }

  const merged = [...existingRows, ...flatOut];
  saveCsvData(tag, merged);
  const keys = getSliceKeysForRows(merged);
  const newKeys = new Set(getSliceKeysForRows(flatOut));
  const addedSlices = [...newKeys];

  return {
    rowCount: merged.length,
    sliceCount: keys.size,
    addedSlices,
    replacedSlices: [],
    bumpedSlices,
  };
}

export type CsvUploadScanSummary = {
  rowCount: number;
  dates: Array<{ iso: string; count: number }>;
  slices: Array<{
    sliceKey: string;
    rowCount: number;
    phoneBankName: string;
    isoDate: string;
  }>;
};

export function summarizeRowsForUploadUi(rows: PhoneBankCsvRow[]): CsvUploadScanSummary {
  const datesCount = new Map<string, number>();
  for (const r of rows) {
    const iso = normalizeDateToIso(r.date);
    if (!iso) continue;
    datesCount.set(iso, (datesCount.get(iso) ?? 0) + 1);
  }
  const dates = [...datesCount.entries()]
    .map(([iso, count]) => ({ iso, count }))
    .sort((a, b) => a.iso.localeCompare(b.iso));
  const groups = groupRowsBySliceKey(rows);
  const slices: CsvUploadScanSummary["slices"] = [];
  for (const [sliceKey, g] of groups.entries()) {
    const f = g[0];
    if (!f) continue;
    slices.push({
      sliceKey,
      rowCount: g.length,
      phoneBankName: f.phoneBankName,
      isoDate: normalizeDateToIso(f.date) ?? "",
    });
  }
  slices.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  return { rowCount: rows.length, dates, slices };
}

export function mergeCsvDataBySlice(tag: string, incomingRows: PhoneBankCsvRow[]): {
  rowCount: number;
  replacedSliceCount: number;
  insertedSliceCount: number;
  sliceCount: number;
} {
  const r = mergeCsvUpload({
    tag,
    incomingRows,
    mode: "add",
    focus: "general",
    acknowledgeTombstone: true,
  });
  return {
    rowCount: r.rowCount,
    replacedSliceCount: r.bumpedSlices.length,
    insertedSliceCount: r.addedSlices.length,
    sliceCount: r.sliceCount,
  };
}

/** Original merge: incoming slice keys overwrite existing slices with the same key. */
export function mergeCsvDataBySliceOverwrite(tag: string, incomingRows: PhoneBankCsvRow[]): {
  rowCount: number;
  replacedSliceCount: number;
  insertedSliceCount: number;
  sliceCount: number;
} {
  const existingRows = loadCsvData(tag) ?? [];

  const existingBySlice = new Map<string, PhoneBankCsvRow[]>();
  for (const row of existingRows) {
    const key = rowSliceKey(row);
    if (!key) continue;
    const arr = existingBySlice.get(key) ?? [];
    arr.push(row);
    existingBySlice.set(key, arr);
  }

  const incomingBySlice = new Map<string, PhoneBankCsvRow[]>();
  for (const row of incomingRows) {
    const key = rowSliceKey(row);
    if (!key) continue;
    const arr = incomingBySlice.get(key) ?? [];
    arr.push(row);
    incomingBySlice.set(key, arr);
  }

  let replacedSliceCount = 0;
  let insertedSliceCount = 0;
  for (const [key, sliceRows] of incomingBySlice.entries()) {
    if (existingBySlice.has(key)) replacedSliceCount += 1;
    else insertedSliceCount += 1;
    existingBySlice.set(key, sliceRows);
  }

  const mergedRows = Array.from(existingBySlice.values()).flat();
  saveCsvData(tag, mergedRows);

  return {
    rowCount: mergedRows.length,
    replacedSliceCount,
    insertedSliceCount,
    sliceCount: existingBySlice.size,
  };
}
