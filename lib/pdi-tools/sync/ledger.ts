import * as fs from "fs";
import * as path from "path";
import { getBigQueryClient, runQuery } from "@/lib/bigquery";
import { ensurePdiSyncExportsDir } from "@/lib/pdi-tools/sync-working-dir";
import { ensurePdiSyncTables } from "./bq-sync-bootstrap";
import { BQ_FLAG_INSTANCES_TABLE, BQ_FLAGS_TABLE, BQ_LEDGER_TABLE, LEDGER_INSERT_CHUNK } from "./constants";
import type { SyncLogger } from "./logger";

/** One posted flag. Duplicate identity is the person, PDI question, flag, and posted day. */
export type LedgerEntry = {
  pdi_id: string;
  flag_code: string;
  flag_id?: string;
  question_id?: string;
  flag_date: string;
};

function fieldText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "value" in value) {
    return String((value as { value?: unknown }).value ?? "").trim();
  }
  return String(value).trim();
}

export function normalizeLedgerPdiId(pdiId: string): string {
  return pdiId.trim().toUpperCase();
}

export function normalizeLedgerFlagCode(flagCode: string): string {
  return flagCode.trim().toUpperCase();
}

/** Calendar day from a DATE, DATETIME, or timestamp string. Empty when none is present. */
export function normalizeLedgerFlagDate(flagDate: string): string {
  const match = /(\d{4}-\d{2}-\d{2})/.exec(flagDate.trim());
  return match?.[1] ?? "";
}

export function ledgerKey(
  pdiId: string,
  flagCode: string,
  flagDate: string,
  questionId?: string
): string {
  const id = normalizeLedgerPdiId(pdiId);
  const code = normalizeLedgerFlagCode(flagCode);
  const date = normalizeLedgerFlagDate(flagDate);
  const question = questionId?.trim() ?? "";
  if (!id || !code || !date) return "";
  if (!question) return `${id}|${code}|${date}`;
  return `${id}|${question}|${code}|${date}`;
}

/** Registry code → flag id, and flag id → the code a mapping report looks up. */
export type LedgerFlagAliases = {
  codeMap: Map<string, string>;
  flagIdToCode: Map<string, string>;
  /** Uppercased flag code or flag id → PDI question ids that post that flag. */
  flagQuestionIds?: Map<string, string[]>;
  /** Uppercased flag code or flag id → how many PDI questions use that flag in the catalog. */
  flagCatalogCounts?: Map<string, number>;
  /** PDI question id → STW question labels used to read older rows that have no question id. */
  questionLabels?: Map<string, string[]>;
};

/**
 * One calendar day per stored flag.
 * Midnight UTC is the calendar date that was posted (`2026-09-13T00:00:00` is September 13).
 * A timestamp with a clock time uses the Pacific day. Ledger rows store that same day in both columns.
 */
export function ledgerDaysForStoredFlag(utcDate: string, pacificDate: string, utcTime: string): string[] {
  const utc = normalizeLedgerFlagDate(utcDate);
  const pacific = normalizeLedgerFlagDate(pacificDate);
  const time = utcTime.trim();
  const dateOnly = time === "" || time.startsWith("00:00:00");
  const day = dateOnly ? utc || pacific : pacific || utc;
  return day ? [day] : [];
}

/**
 * Stored PDI code, plus the mapping's flag id and report code when they name the same flag.
 * A different flag id is not included.
 */
export function ledgerCodesForStoredFlag(storedCode: string, maps: LedgerFlagAliases): string[] {
  const stored = normalizeLedgerFlagCode(storedCode);
  if (!stored) return [];
  const codes = new Set<string>([stored]);
  const flagId =
    maps.codeMap.get(stored) ??
    [...maps.flagIdToCode.keys()].find((id) => normalizeLedgerFlagCode(id) === stored) ??
    "";
  if (!flagId) return [...codes];
  codes.add(normalizeLedgerFlagCode(flagId));
  const reportCode = maps.flagIdToCode.get(flagId);
  if (reportCode) codes.add(normalizeLedgerFlagCode(reportCode));
  return [...codes];
}

const QUESTION_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "for",
  "of",
  "on",
  "in",
  "your",
  "you",
  "we",
  "can",
  "count",
  "will",
  "with",
  "us",
  "our",
  "vote",
  "voting",
  "support",
  "yes",
  "no",
  "la",
  "el",
  "para",
  "que",
  "con",
  "su",
  "de",
  "por",
  "los",
  "las",
  "una",
  "un",
]);

/** Compare STW labels with PDI question text. Leading numbers and punctuation are ignored. */
export function normalizeQuestionLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\d+\.\s*/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionSignatures(value: string): Set<string> {
  const tokens = normalizeQuestionLabel(value).split(" ").filter(Boolean);
  const signatures = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const next = tokens[i + 1] ?? "";
    if (next && (/\d/.test(token) || /\d/.test(next))) signatures.add(`${token} ${next}`);
    if (!QUESTION_STOPWORDS.has(token) && token.length >= 5 && !/^\d+$/.test(token)) signatures.add(token);
  }
  return signatures;
}

/** Above this, the flag registry treats a flag as generic across PDI questions. */
const GENERIC_FLAG_QUESTION_COUNT = 3;

function questionIdsForFlag(storedCode: string, maps: LedgerFlagAliases): string[] {
  const index = maps.flagQuestionIds;
  if (!index) return [];
  const ids = new Set<string>();
  for (const code of ledgerCodesForStoredFlag(storedCode, maps)) {
    for (const id of index.get(code) ?? []) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function catalogCountForFlag(storedCode: string, maps: LedgerFlagAliases): number {
  const counts = maps.flagCatalogCounts;
  if (!counts) return 0;
  let count = 0;
  for (const code of ledgerCodesForStoredFlag(storedCode, maps)) {
    count = Math.max(count, counts.get(code) ?? 0);
  }
  return count;
}

/**
 * One mapped question owns an older row only when that flag is not generic in PDI.
 * SS is on more than a hundred PDI questions, so a mapping file that lists just one
 * of them does not get every historical SS.
 */
function soleQuestionForUnscopedFlag(storedCode: string, maps: LedgerFlagAliases): string {
  const candidates = questionIdsForFlag(storedCode, maps);
  if (candidates.length !== 1) return "";
  const catalogCount = catalogCountForFlag(storedCode, maps);
  if (catalogCount > GENERIC_FLAG_QUESTION_COUNT && catalogCount > candidates.length) return "";
  return candidates[0]!;
}

/**
 * Match stored question text to one PDI question that uses this flag.
 * A shared phrase that hits two questions matches neither.
 */
export function matchQuestionIdsFromText(
  questionText: string,
  candidateIds: string[],
  maps: LedgerFlagAliases
): string[] {
  const labels = maps.questionLabels;
  if (!labels || candidateIds.length === 0 || !questionText.trim()) return [];
  const stored = normalizeQuestionLabel(questionText);
  if (stored.length >= 12) {
    const contained = candidateIds.filter((id) =>
      (labels.get(id) ?? []).some((name) => {
        const label = normalizeQuestionLabel(name);
        if (label.length < 12) return false;
        return label === stored || stored.startsWith(label) || label.startsWith(stored);
      })
    );
    if (contained.length === 1) return contained;
    if (contained.length > 1) return [];
  }

  const storedSignatures = questionSignatures(questionText);
  if (storedSignatures.size === 0) return [];
  const hits = candidateIds.filter((id) => {
    const signatures = new Set<string>();
    for (const name of labels.get(id) ?? []) {
      for (const signature of questionSignatures(name)) signatures.add(signature);
    }
    for (const signature of storedSignatures) {
      if (signatures.has(signature)) return true;
    }
    return false;
  });
  return hits.length === 1 ? hits : [];
}

/**
 * Question id to store with a ledger row.
 * A flag used by several questions stays blank unless the text names exactly one of them.
 */
export function resolveStoredQuestionId(
  storedCode: string,
  maps?: LedgerFlagAliases,
  questionId?: string,
  questionText?: string
): string {
  const explicit = questionId?.trim() ?? "";
  if (explicit) return explicit;
  if (!maps) return "";
  const candidates = questionIdsForFlag(storedCode, maps);
  const fromText = questionText?.trim()
    ? matchQuestionIdsFromText(questionText, candidates, maps)
    : [];
  if (fromText.length === 1) return fromText[0]!;
  return soleQuestionForUnscopedFlag(storedCode, maps);
}

/** The next calendar day. PDI often stores a flag on the day before the report date. */
export function nextLedgerDay(flagDate: string): string {
  const date = normalizeLedgerFlagDate(flagDate);
  if (!date) return "";
  const utc = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(utc)) return "";
  return new Date(utc + 86_400_000).toISOString().slice(0, 10);
}

export function addStoredFlagToLedger(
  ledger: Set<string>,
  pdiId: string,
  storedCode: string,
  flagDate: string,
  maps?: LedgerFlagAliases,
  questionId?: string,
  questionText?: string,
  includeFollowingDay = true
): void {
  const explicit = questionId?.trim() ?? "";
  const candidates = maps ? questionIdsForFlag(storedCode, maps) : [];
  const fromText =
    !explicit && maps && questionText?.trim()
      ? matchQuestionIdsFromText(questionText, candidates, maps)
      : [];
  const scoped =
    explicit || (fromText.length === 1 ? fromText[0]! : "") || (maps ? soleQuestionForUnscopedFlag(storedCode, maps) : "");
  if (!scoped && candidates.length > 1) return;
  if (!scoped && maps && catalogCountForFlag(storedCode, maps) > GENERIC_FLAG_QUESTION_COUNT) return;

  const dates = [flagDate];
  if (includeFollowingDay && scoped) {
    const next = nextLedgerDay(flagDate);
    if (next) dates.push(next);
  }
  const codes = maps ? ledgerCodesForStoredFlag(storedCode, maps) : [normalizeLedgerFlagCode(storedCode)];
  for (const date of dates) {
    for (const code of codes) {
      const key = ledgerKey(pdiId, code, date, scoped || undefined);
      if (key) ledger.add(key);
    }
  }
}

/**
 * Same person, same flag, same day, same PDI question.
 * An older row with no question id does not block every question that uses the flag.
 */
export function ledgerHasPostedFlag(
  ledger: Set<string>,
  pdiId: string,
  flagCode: string,
  flagDate: string,
  flagId?: string,
  questionId?: string
): boolean {
  const question = questionId?.trim() ?? "";
  const codeKey = ledgerKey(pdiId, flagCode, flagDate, question || undefined);
  if (codeKey && ledger.has(codeKey)) return true;
  const idKey = flagId ? ledgerKey(pdiId, flagId, flagDate, question || undefined) : "";
  return Boolean(idKey && idKey !== codeKey && ledger.has(idKey));
}

type LedgerRow = {
  pdi_id: string;
  flag_code: string;
  flag_id?: string | null;
  question_id?: string | null;
  question_text?: string | null;
  posted_at?: string | { value?: string } | null;
  flag_date: string | { value?: string };
  flag_date_pacific?: string | { value?: string } | null;
  flag_time_utc?: string | { value?: string } | null;
};

export type UnscopedPostedFlag = {
  pdiId: string;
  flagCode: string;
  flagId: string;
  flagDate: string;
  postedAtMs: number;
};

export type PostedFlagPreview = {
  pdiId: string;
  questionId: string;
  flagId: string;
  flagDate: string;
  previewAtMs: number;
};

function ledgerLoadSql(includeQuestion: boolean): string {
  const flagQuestion = includeQuestion
    ? "'' AS question_id, IFNULL(question_text, '') AS question_text, '' AS posted_at,"
    : "'' AS question_id, '' AS question_text, '' AS posted_at,";
  const ledgerQuestion = includeQuestion
    ? "IFNULL(question_id, '') AS question_id, '' AS question_text, CAST(synced_at AS STRING) AS posted_at,"
    : "'' AS question_id, '' AS question_text, CAST(synced_at AS STRING) AS posted_at,";
  const instanceQuestion = includeQuestion
    ? "IFNULL(question_id, '') AS question_id, '' AS question_text, CAST(created_at AS STRING) AS posted_at,"
    : "'' AS question_id, '' AS question_text, CAST(created_at AS STRING) AS posted_at,";
  return `
      SELECT
        pdi_id,
        flag_code,
        flag_id,
        ${flagQuestion}
        CAST(DATE(flag_entry_date) AS STRING) AS flag_date,
        CAST(DATE(flag_entry_date, 'America/Los_Angeles') AS STRING) AS flag_date_pacific,
        CAST(TIME(flag_entry_date) AS STRING) AS flag_time_utc
      FROM \`${BQ_FLAGS_TABLE}\`
      UNION DISTINCT
      SELECT
        pdi_id,
        flag_code,
        flag_id,
        ${ledgerQuestion}
        CAST(flag_date AS STRING) AS flag_date,
        CAST(flag_date AS STRING) AS flag_date_pacific,
        '00:00:00' AS flag_time_utc
      FROM \`${BQ_LEDGER_TABLE}\`
      UNION DISTINCT
      SELECT
        pdi_id,
        flag_code,
        flag_id,
        ${instanceQuestion}
        CAST(flag_date AS STRING) AS flag_date,
        CAST(flag_date AS STRING) AS flag_date_pacific,
        '00:00:00' AS flag_time_utc
      FROM \`${BQ_FLAG_INSTANCES_TABLE}\`
    `;
}

function postedAtMs(value: string): number {
  let text = value.trim();
  if (!text) return 0;
  if (!text.includes("T")) text = text.replace(" ", "T");
  text = text.replace(/([+-]\d{2})$/, "$1:00");
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function previewKey(pdiId: string, flagId: string, flagDate: string): string {
  const id = normalizeLedgerPdiId(pdiId);
  const flag = flagId.trim().toUpperCase();
  const date = normalizeLedgerFlagDate(flagDate);
  if (!id || !flag || !date) return "";
  return `${id}|${flag}|${date}`;
}

/**
 * Older posts stored person + flag + day and left the question id off the ledger.
 * A payload preview written at or before that post still has the question.
 * A later dry run does not.
 */
export function applyPostedQuestionPreviews(
  ledger: Set<string>,
  unscoped: UnscopedPostedFlag[],
  previews: PostedFlagPreview[],
  maps?: LedgerFlagAliases
): LedgerEntry[] {
  const byFlag = new Map<string, PostedFlagPreview[]>();
  for (const preview of previews) {
    const key = previewKey(preview.pdiId, preview.flagId, preview.flagDate);
    if (!key || !preview.questionId.trim() || !preview.previewAtMs) continue;
    const list = byFlag.get(key) ?? [];
    list.push(preview);
    byFlag.set(key, list);
  }

  const entries: LedgerEntry[] = [];
  const seen = new Set<string>();
  for (const row of unscoped) {
    if (!row.postedAtMs) continue;
    const flagIds = new Set<string>();
    if (row.flagId.trim()) flagIds.add(row.flagId.trim());
    const fromCode = maps?.codeMap.get(row.flagCode.trim().toUpperCase());
    if (fromCode) flagIds.add(fromCode);
    for (const flagId of flagIds) {
      const matches = byFlag.get(previewKey(row.pdiId, flagId, row.flagDate)) ?? [];
      for (const preview of matches) {
        if (preview.previewAtMs > row.postedAtMs) continue;
        const questionId = preview.questionId.trim();
        const identity = `${previewKey(row.pdiId, flagId, row.flagDate)}|${questionId}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const scopedKey = ledgerKey(row.pdiId, flagId, row.flagDate, questionId);
        const already = Boolean(scopedKey && ledger.has(scopedKey));
        addStoredFlagToLedger(ledger, row.pdiId, row.flagCode || flagId, row.flagDate, maps, questionId, undefined, true);
        if (row.flagId) {
          addStoredFlagToLedger(ledger, row.pdiId, row.flagId, row.flagDate, maps, questionId, undefined, true);
        }
        if (!already) {
          entries.push({
            pdi_id: row.pdiId,
            flag_code: row.flagCode || flagId,
            flag_id: flagId,
            question_id: questionId,
            flag_date: normalizeLedgerFlagDate(row.flagDate),
          });
        }
      }
    }
  }
  return entries;
}

function payloadPreviewTimeMs(fileName: string): number {
  const match = /pdi_payload_preview_(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})/i.exec(fileName);
  if (!match) return 0;
  return Date.parse(`${match[1]}T${match[2]}:${match[3]}:00Z`);
}

function readPostedFlagPreviews(log: SyncLogger): PostedFlagPreview[] {
  const dir = ensurePdiSyncExportsDir();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const previews: PostedFlagPreview[] = [];
  for (const name of names) {
    if (!/^pdi_payload_preview_.*\.csv$/i.test(name)) continue;
    const previewAtMs = payloadPreviewTimeMs(name);
    if (!previewAtMs) continue;
    let text = "";
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8");
    } catch (e) {
      log.warn(`Could not read ${name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const lines = text.split(/\r?\n/);
    const header = lines[0]?.split(",") ?? [];
    const pdiCol = header.indexOf("pdiId");
    const questionCol = header.indexOf("questionId");
    const flagCol = header.indexOf("flagId");
    const dateCol = header.indexOf("flagEntryDate");
    if (pdiCol < 0 || questionCol < 0 || flagCol < 0 || dateCol < 0) continue;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = line.split(",");
      const pdiId = cols[pdiCol]?.trim() ?? "";
      const questionId = cols[questionCol]?.trim() ?? "";
      const flagId = cols[flagCol]?.trim() ?? "";
      const flagDate = cols[dateCol]?.trim() ?? "";
      if (!pdiId || !questionId || !flagId || !flagDate) continue;
      previews.push({ pdiId, questionId, flagId, flagDate, previewAtMs });
    }
  }
  return previews;
}

export async function loadLedger(log: SyncLogger, maps?: LedgerFlagAliases): Promise<Set<string>> {
  try {
    await ensurePdiSyncTables(log);
    let rows: LedgerRow[];
    try {
      rows = await runQuery<LedgerRow>(ledgerLoadSql(true));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/unrecognized name|question_id|question_text/i.test(message)) throw e;
      log.warn(`Ledger question columns unavailable; shared flags stay unscoped until the column exists: ${message}`);
      rows = await runQuery<LedgerRow>(ledgerLoadSql(false));
    }
    const keys = new Set<string>();
    const unscoped: UnscopedPostedFlag[] = [];
    for (const r of rows) {
      const days = ledgerDaysForStoredFlag(
        fieldText(r.flag_date),
        fieldText(r.flag_date_pacific),
        fieldText(r.flag_time_utc)
      );
      const pdiId = fieldText(r.pdi_id);
      const flagCode = fieldText(r.flag_code);
      const flagId = fieldText(r.flag_id);
      const questionId = fieldText(r.question_id);
      const questionText = fieldText(r.question_text);
      const posted = postedAtMs(fieldText(r.posted_at));
      for (const day of days) {
        const resolved = resolveStoredQuestionId(flagCode, maps, questionId, questionText);
        if (resolved) {
          addStoredFlagToLedger(keys, pdiId, flagCode, day, maps, resolved, questionText);
          if (flagId) addStoredFlagToLedger(keys, pdiId, flagId, day, maps, resolved, questionText);
        } else if (posted) {
          unscoped.push({ pdiId, flagCode, flagId, flagDate: day, postedAtMs: posted });
        } else {
          addStoredFlagToLedger(keys, pdiId, flagCode, day, maps, undefined, questionText);
          if (flagId) addStoredFlagToLedger(keys, pdiId, flagId, day, maps, undefined, questionText);
        }
      }
    }
    if (unscoped.length > 0) {
      const recovered = applyPostedQuestionPreviews(keys, unscoped, readPostedFlagPreviews(log), maps);
      if (recovered.length > 0) {
        await appendLedgerEntries(recovered, "payload_preview", "question-backfill", log);
        log.info(`Attached ${recovered.length} posted flag(s) to the question from the original payload`);
      }
    }
    log.info(
      `Loaded ${keys.size} dedup keys from BQ (${BQ_FLAGS_TABLE} + ${BQ_LEDGER_TABLE} + ${BQ_FLAG_INSTANCES_TABLE})`
    );
    return keys;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`BQ ledger load failed: ${message}`);
    throw new Error(`BQ ledger load failed: ${message}`);
  }
}

export async function appendLedgerEntries(
  entries: LedgerEntry[],
  source: string,
  runId: string,
  log: SyncLogger
): Promise<void> {
  if (entries.length === 0) return;

  const nowTs = new Date().toISOString();
  const rows = entries.map((e) => {
    const flagId = e.flag_id?.trim() ?? "";
    const questionId = e.question_id?.trim() ?? "";
    return {
      ledger_key: ledgerKey(e.pdi_id, flagId || e.flag_code, e.flag_date, questionId || undefined),
      pdi_id: e.pdi_id,
      flag_code: e.flag_code,
      flag_id: flagId || null,
      question_id: questionId || null,
      flag_date: e.flag_date,
      synced_at: nowTs,
      source,
      run_id: runId,
    };
  });

  const bq = getBigQueryClient();
  const [, datasetId, tableId] = BQ_LEDGER_TABLE.split(".");
  const tbl = bq.dataset(datasetId!).table(tableId!);

  for (let i = 0; i < rows.length; i += LEDGER_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + LEDGER_INSERT_CHUNK);
    try {
      await tbl.insert(chunk);
    } catch (e) {
      log.warn(
        `BQ ledger insert error (chunk ${i / LEDGER_INSERT_CHUNK + 1}): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  log.info(`Appended ${rows.length} entries to BQ ledger`);
}
