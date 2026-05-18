/**
 * Per-tag learned mapping: normalized wide CSV header → dashboard numeric field.
 * Updated after each successful STW wide import so the next convert uses the same column→field links.
 */
import fs from "fs";
import path from "path";
import { EMPTY_CSV_ROW, type PhoneBankCsvRow } from "./types";
import { normalizeWideHeaderKey } from "./wide-header-utils";

const DATA_DIR = path.join(process.cwd(), "data");

function safeTag(tag: string): string {
  return tag.replace(/[^a-z0-9_-]/gi, "");
}

function fp(tag: string): string {
  return path.join(DATA_DIR, `stw-wide-header-field-map-${safeTag(tag)}.json`);
}

const ALLOWED_FIELD = new Set(
  Object.keys(EMPTY_CSV_ROW) as (keyof typeof EMPTY_CSV_ROW)[]
);

function isAllowedField(f: string): f is keyof PhoneBankCsvRow {
  return ALLOWED_FIELD.has(f as keyof typeof EMPTY_CSV_ROW);
}

export function loadWideHeaderFieldMap(tag: string): Record<string, keyof PhoneBankCsvRow> | null {
  const p = fp(tag);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, string>;
    const out: Record<string, keyof PhoneBankCsvRow> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k !== "string" || typeof v !== "string") continue;
      if (!isAllowedField(v)) continue;
      out[normalizeWideHeaderKey(k)] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function mergeWideHeaderFieldMap(
  tag: string,
  incoming: Record<string, keyof PhoneBankCsvRow>
): void {
  const prev = loadWideHeaderFieldMap(tag) ?? {};
  for (const [hdr, field] of Object.entries(incoming)) {
    if (!isAllowedField(field)) continue;
    prev[normalizeWideHeaderKey(hdr)] = field;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fp(tag), JSON.stringify(prev, null, 2), "utf-8");
}
