import fs from "fs";
import path from "path";
import { refreshWindowStartDate } from "./snapshot-merge";

const INDEX_DIR = path.join(process.cwd(), "data", "bq-snapshots", "_indexes");

export type CalleeIdentityRecord = {
  pdiId: string;
  voterName: string;
  voterAddress: string;
  /** True after a callee JSON lookup, including when BigQuery had no address. */
  addressChecked?: boolean;
};

type TextPdiIndexFile = {
  version: number;
  queryStartedAt: string | null;
  byContactId: Record<string, string>;
};

type CalleeIndexFile = {
  version: number;
  queryStartedAt: string | null;
  byCalleeId: Record<string, CalleeIdentityRecord>;
};

function ensureIndexDir(): void {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
}

function readJson<T>(name: string): T | null {
  const fp = path.join(INDEX_DIR, name);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadTextIndex(): TextPdiIndexFile {
  const data = readJson<TextPdiIndexFile>("text-contact-pdi.json");
  if (!data || !data.byContactId || typeof data.byContactId !== "object") {
    return { version: 1, queryStartedAt: null, byContactId: {} };
  }
  return data;
}

function loadCalleeIndex(): CalleeIndexFile {
  const data = readJson<CalleeIndexFile>("callee-identity.json");
  if (!data || !data.byCalleeId || typeof data.byCalleeId !== "object") {
    return { version: 1, queryStartedAt: null, byCalleeId: {} };
  }
  return data;
}

export function lookupTextContactPdi(contactId: string): string {
  if (!contactId) return "";
  return loadTextIndex().byContactId[contactId] ?? "";
}

/** One read of the text PDI index for a contact fetch. Do not look up one id at a time. */
export function readTextContactPdiIndex(): {
  byContactId: Record<string, string>;
  windowStart: string | null;
} {
  const data = loadTextIndex();
  return {
    byContactId: data.byContactId,
    windowStart: data.queryStartedAt ? refreshWindowStartDate(data.queryStartedAt) : null,
  };
}

export function lookupCalleeIdentity(calleeId: string): CalleeIdentityRecord | null {
  if (!calleeId) return null;
  return loadCalleeIndex().byCalleeId[calleeId] ?? null;
}

/** One read of the callee index for a survey fetch. Do not look up one id at a time. */
export function readCalleeIdentityIndex(): {
  byCalleeId: Record<string, CalleeIdentityRecord>;
  windowStart: string | null;
} {
  const data = loadCalleeIndex();
  return {
    byCalleeId: data.byCalleeId,
    windowStart: data.queryStartedAt ? refreshWindowStartDate(data.queryStartedAt) : null,
  };
}

export function textPdiIndexWindowStart(): string | null {
  const at = loadTextIndex().queryStartedAt;
  return at ? refreshWindowStartDate(at) : null;
}

export function calleeIndexWindowStart(): string | null {
  const at = loadCalleeIndex().queryStartedAt;
  return at ? refreshWindowStartDate(at) : null;
}

export function mergeTextContactPdiIndex(
  entries: ReadonlyArray<{ contactId: string; pdiId: string }>,
  queryStartedAt: string | null
): void {
  const index = loadTextIndex();
  for (const entry of entries) {
    if (!entry.contactId || !entry.pdiId) continue;
    if (!index.byContactId[entry.contactId]) index.byContactId[entry.contactId] = entry.pdiId;
  }
  if (queryStartedAt) index.queryStartedAt = queryStartedAt;
  ensureIndexDir();
  fs.writeFileSync(path.join(INDEX_DIR, "text-contact-pdi.json"), JSON.stringify(index), "utf-8");
}

export function mergeCalleeIdentityIndex(
  entries: ReadonlyArray<{ calleeId: string } & CalleeIdentityRecord>,
  queryStartedAt: string | null
): void {
  const index = loadCalleeIndex();
  for (const entry of entries) {
    if (!entry.calleeId) continue;
    const prev = index.byCalleeId[entry.calleeId];
    index.byCalleeId[entry.calleeId] = {
      pdiId: prev?.pdiId || entry.pdiId || "",
      voterName: prev?.voterName || entry.voterName || "",
      voterAddress: prev?.voterAddress || entry.voterAddress || "",
      addressChecked: true,
    };
  }
  if (queryStartedAt) index.queryStartedAt = queryStartedAt;
  ensureIndexDir();
  fs.writeFileSync(path.join(INDEX_DIR, "callee-identity.json"), JSON.stringify(index), "utf-8");
}
