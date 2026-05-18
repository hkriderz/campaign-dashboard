/**
 * Tracks CSV slices the user removed so we can warn on re-import or when BQ still shows that day.
 * One JSON file per tag under /data.
 */
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_VERSION = 1 as const;

export type CsvSliceTombstoneReason = "delete" | "replace";

export type CsvSliceTombstoneEntry = {
  sliceKey: string;
  removedAt: string;
  reason: CsvSliceTombstoneReason;
  phoneBankName?: string;
  isoDate?: string;
};

export type CsvSliceTombstonesFile = {
  version: typeof FILE_VERSION;
  entries: CsvSliceTombstoneEntry[];
};

function tombstonePath(tag: string): string {
  const safe = tag.replace(/[^a-z0-9_-]/gi, "");
  return path.join(DATA_DIR, `phonebanking-csv-tombstones-${safe}.json`);
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadTombstones(tag: string): CsvSliceTombstonesFile {
  const fp = tombstonePath(tag);
  if (!fs.existsSync(fp)) {
    return { version: FILE_VERSION, entries: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as CsvSliceTombstonesFile;
    if (raw.version !== FILE_VERSION || !Array.isArray(raw.entries)) {
      return { version: FILE_VERSION, entries: [] };
    }
    return raw;
  } catch {
    return { version: FILE_VERSION, entries: [] };
  }
}

export function saveTombstones(tag: string, data: CsvSliceTombstonesFile): void {
  ensureDataDir();
  const fp = tombstonePath(tag);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}

export function getTombstonedSliceKeys(tag: string): Set<string> {
  return new Set(loadTombstones(tag).entries.map((e) => e.sliceKey));
}

export function isSliceTombstoned(tag: string, sliceKey: string): boolean {
  return loadTombstones(tag).entries.some((e) => e.sliceKey === sliceKey);
}

export function addTombstone(
  tag: string,
  entry: Omit<CsvSliceTombstoneEntry, "removedAt"> & { removedAt?: string }
): void {
  const cur = loadTombstones(tag);
  const next = cur.entries.filter((e) => e.sliceKey !== entry.sliceKey);
  next.push({
    ...entry,
    removedAt: entry.removedAt ?? new Date().toISOString(),
  });
  saveTombstones(tag, { version: FILE_VERSION, entries: next });
}

export function removeTombstone(tag: string, sliceKey: string): void {
  const cur = loadTombstones(tag);
  saveTombstones(tag, {
    version: FILE_VERSION,
    entries: cur.entries.filter((e) => e.sliceKey !== sliceKey),
  });
}

export function listTombstoneEntries(tag: string): CsvSliceTombstoneEntry[] {
  return [...loadTombstones(tag).entries].sort((a, b) =>
    b.removedAt.localeCompare(a.removedAt)
  );
}

/** Wipes the per-tag removal log (all tombstone entries). Returns how many were removed. */
export function clearAllTombstones(tag: string): number {
  const cur = loadTombstones(tag);
  const count = cur.entries.length;
  if (count === 0) return 0;
  saveTombstones(tag, { version: FILE_VERSION, entries: [] });
  return count;
}
