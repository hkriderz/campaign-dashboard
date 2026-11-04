import fs from "fs";
import path from "path";
import { normalizeRecontactPersonId } from "@/lib/qc-recontact/ids";
import type {
  PdiIdentityIndexFile,
  PdiIdentityRecord,
  PdiIdentityUpsertInput,
} from "./types";

const DEFAULT_INDEX_DIR = path.join(process.cwd(), "data", "bq-snapshots", "_indexes");
let indexPathForTests: string | null = null;

function indexPath(): string {
  return indexPathForTests ?? path.join(DEFAULT_INDEX_DIR, "pdi-identity.json");
}

function indexDir(): string {
  return path.dirname(indexPath());
}

/** Test helper: point the store at a temp file. Pass null to restore default. */
export function setPdiIdentityIndexPathForTests(nextPath: string | null): void {
  indexPathForTests = nextPath;
}

function emptyIndex(): PdiIdentityIndexFile {
  return { version: 1, byPdiId: {} };
}

function ensureIndexDir(): void {
  fs.mkdirSync(indexDir(), { recursive: true });
}

export function loadPdiIdentityIndex(): PdiIdentityIndexFile {
  const filePath = indexPath();
  if (!fs.existsSync(filePath)) return emptyIndex();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PdiIdentityIndexFile;
    if (!raw || raw.version !== 1 || typeof raw.byPdiId !== "object" || !raw.byPdiId) {
      return emptyIndex();
    }
    return raw;
  } catch {
    return emptyIndex();
  }
}

function writeIndex(index: PdiIdentityIndexFile): void {
  ensureIndexDir();
  const filePath = indexPath();
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export function readPdiIdentityMap(): Record<string, PdiIdentityRecord> {
  return loadPdiIdentityIndex().byPdiId;
}

export function lookupPdiIdentity(pdiId: string): PdiIdentityRecord | null {
  const key = normalizeRecontactPersonId(pdiId);
  if (!key) return null;
  return loadPdiIdentityIndex().byPdiId[key] ?? null;
}

export function listPdiIdentities(): PdiIdentityRecord[] {
  return Object.values(loadPdiIdentityIndex().byPdiId).sort((a, b) =>
    a.pdiId.localeCompare(b.pdiId)
  );
}

function mergeRecord(
  prev: PdiIdentityRecord | undefined,
  input: PdiIdentityUpsertInput,
  updatedAt: string
): PdiIdentityRecord | null {
  const pdiId = normalizeRecontactPersonId(input.pdiId);
  if (!pdiId) return null;

  const replaceEmpty = Boolean(input.replaceEmpty);
  const nextName =
    input.voterName === undefined
      ? prev?.voterName ?? ""
      : input.voterName.trim() || (replaceEmpty ? "" : prev?.voterName ?? "");
  const nextAddress =
    input.voterAddress === undefined
      ? prev?.voterAddress ?? ""
      : input.voterAddress.trim() || (replaceEmpty ? "" : prev?.voterAddress ?? "");
  const nextNote =
    input.note === undefined
      ? prev?.note
      : input.note.trim() || (replaceEmpty ? undefined : prev?.note);

  // Brand-new row with no usable fields is skipped.
  if (!prev && !nextName && !nextAddress && !nextNote) return null;

  return {
    pdiId,
    voterName: nextName,
    voterAddress: nextAddress,
    updatedAt,
    ...(nextNote ? { note: nextNote } : {}),
  };
}

/**
 * Upsert one or more PDI identity rows. Returns the saved records (normalized keys).
 * Rows with an empty PDI id are skipped.
 */
export function upsertPdiIdentities(
  inputs: readonly PdiIdentityUpsertInput[]
): { saved: PdiIdentityRecord[]; skippedNoPdiId: number } {
  const index = loadPdiIdentityIndex();
  const now = new Date().toISOString();
  const saved: PdiIdentityRecord[] = [];
  let skippedNoPdiId = 0;

  for (const input of inputs) {
    const key = normalizeRecontactPersonId(input.pdiId);
    if (!key) {
      skippedNoPdiId += 1;
      continue;
    }
    const merged = mergeRecord(index.byPdiId[key], { ...input, pdiId: key }, now);
    if (!merged) {
      skippedNoPdiId += 1;
      continue;
    }
    index.byPdiId[key] = merged;
    saved.push(merged);
  }

  if (saved.length) writeIndex(index);
  return { saved, skippedNoPdiId };
}

export function deletePdiIdentities(pdiIds: readonly string[]): {
  deleted: string[];
  missing: string[];
} {
  const index = loadPdiIdentityIndex();
  const deleted: string[] = [];
  const missing: string[] = [];
  for (const raw of pdiIds) {
    const key = normalizeRecontactPersonId(raw);
    if (!key) continue;
    if (index.byPdiId[key]) {
      delete index.byPdiId[key];
      deleted.push(key);
    } else {
      missing.push(key);
    }
  }
  if (deleted.length) writeIndex(index);
  return { deleted, missing };
}

export function clearAllPdiIdentities(): { deletedCount: number } {
  const index = loadPdiIdentityIndex();
  const deletedCount = Object.keys(index.byPdiId).length;
  if (!deletedCount) return { deletedCount: 0 };
  writeIndex(emptyIndex());
  return { deletedCount };
}

/** Fill blank name/address on an object that already has a PDI id. Never overwrites non-empty fields. */
export function applySavedPdiIdentity<T extends { pdiId?: string; voterName?: string; voterAddress?: string }>(
  row: T,
  record: PdiIdentityRecord | null | undefined
): T {
  if (!record) return row;
  const pdiId = normalizeRecontactPersonId(row.pdiId ?? "") || record.pdiId;
  if (!pdiId) return row;
  const voterName = row.voterName?.trim() || record.voterName || "";
  const voterAddress = row.voterAddress?.trim() || record.voterAddress || "";
  if (
    pdiId === (row.pdiId ?? "") &&
    voterName === (row.voterName ?? "") &&
    voterAddress === (row.voterAddress ?? "")
  ) {
    return row;
  }
  return { ...row, pdiId, voterName, voterAddress };
}

export function stampRowsWithPdiIdentityMap<
  T extends { pdiId?: string; voterName?: string; voterAddress?: string },
>(rows: readonly T[], byPdiId: Record<string, PdiIdentityRecord>): T[] {
  if (!rows.length || !Object.keys(byPdiId).length) return rows as T[];
  return rows.map((row) => {
    const key = normalizeRecontactPersonId(row.pdiId ?? "");
    if (!key) return row;
    return applySavedPdiIdentity(row, byPdiId[key]);
  });
}

/** Fill blank QC voter name/address from the PDI identity store. */
export function stampQcPairsWithPdiIdentity<
  T extends { qc: { pdiId: string; voterName: string; voterAddress: string } },
>(pairs: readonly T[]): T[] {
  const byPdiId = readPdiIdentityMap();
  if (!pairs.length || !Object.keys(byPdiId).length) return pairs as T[];
  return pairs.map((pair) => {
    const stamped = applySavedPdiIdentity(
      {
        pdiId: pair.qc.pdiId,
        voterName: pair.qc.voterName,
        voterAddress: pair.qc.voterAddress,
      },
      byPdiId[normalizeRecontactPersonId(pair.qc.pdiId)]
    );
    if (
      stamped.voterName === pair.qc.voterName &&
      stamped.voterAddress === pair.qc.voterAddress &&
      stamped.pdiId === pair.qc.pdiId
    ) {
      return pair;
    }
    return {
      ...pair,
      qc: {
        ...pair.qc,
        pdiId: stamped.pdiId || pair.qc.pdiId,
        voterName: stamped.voterName ?? pair.qc.voterName,
        voterAddress: stamped.voterAddress ?? pair.qc.voterAddress,
      },
    };
  });
}

/** Backfill blank knock-index voter names from the PDI identity store. */
export function stampKnockRowsWithPdiIdentity<T extends { primaryId: string; voterName?: string }>(
  rows: readonly T[]
): T[] {
  const byPdiId = readPdiIdentityMap();
  if (!rows.length || !Object.keys(byPdiId).length) return rows as T[];
  return rows.map((row) => {
    if (row.voterName?.trim()) return row;
    const key = normalizeRecontactPersonId(row.primaryId);
    const record = key ? byPdiId[key] : undefined;
    if (!record?.voterName?.trim()) return row;
    return { ...row, voterName: record.voterName };
  });
}

/** Fill blank Unique ID event voter names from the PDI identity store. */
export function stampUniqueIdEventsWithPdiIdentity<
  T extends { personId: string; voterName: string },
>(events: readonly T[]): T[] {
  const byPdiId = readPdiIdentityMap();
  if (!events.length || !Object.keys(byPdiId).length) return events as T[];
  return events.map((event) => {
    if (event.voterName?.trim()) return event;
    const key = normalizeRecontactPersonId(event.personId);
    const record = key ? byPdiId[key] : undefined;
    if (!record?.voterName?.trim()) return event;
    return { ...event, voterName: record.voterName };
  });
}
