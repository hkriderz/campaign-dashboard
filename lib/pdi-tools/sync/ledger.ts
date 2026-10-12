import { getBigQueryClient, runQuery } from "@/lib/bigquery";
import { ensurePdiSyncTables } from "./bq-sync-bootstrap";
import { BQ_FLAG_INSTANCES_TABLE, BQ_FLAGS_TABLE, BQ_LEDGER_TABLE, LEDGER_INSERT_CHUNK } from "./constants";
import type { SyncLogger } from "./logger";

/** One posted flag. The duplicate identity is `flag_id` plus the person and the posted day. */
export type LedgerEntry = {
  pdi_id: string;
  flag_code: string;
  flag_id?: string;
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

export function ledgerKey(pdiId: string, flagCode: string, flagDate: string): string {
  const id = normalizeLedgerPdiId(pdiId);
  const code = normalizeLedgerFlagCode(flagCode);
  const date = normalizeLedgerFlagDate(flagDate);
  if (!id || !code || !date) return "";
  return `${id}|${code}|${date}`;
}

/** Registry code → flag id, and flag id → the code a mapping report looks up. */
export type LedgerFlagAliases = {
  codeMap: Map<string, string>;
  flagIdToCode: Map<string, string>;
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

export function addStoredFlagToLedger(
  ledger: Set<string>,
  pdiId: string,
  storedCode: string,
  flagDate: string,
  maps?: LedgerFlagAliases
): void {
  const codes = maps ? ledgerCodesForStoredFlag(storedCode, maps) : [normalizeLedgerFlagCode(storedCode)];
  for (const code of codes) {
    const key = ledgerKey(pdiId, code, flagDate);
    if (key) ledger.add(key);
  }
}

/** Same person, same flag, same day. A different flag code or a later day does not match. */
export function ledgerHasPostedFlag(
  ledger: Set<string>,
  pdiId: string,
  flagCode: string,
  flagDate: string,
  flagId?: string
): boolean {
  const codeKey = ledgerKey(pdiId, flagCode, flagDate);
  if (codeKey && ledger.has(codeKey)) return true;
  const idKey = flagId ? ledgerKey(pdiId, flagId, flagDate) : "";
  return Boolean(idKey && idKey !== codeKey && ledger.has(idKey));
}

type LedgerRow = {
  pdi_id: string;
  flag_code: string;
  flag_id?: string | null;
  flag_date: string | { value?: string };
  flag_date_pacific?: string | { value?: string } | null;
  flag_time_utc?: string | { value?: string } | null;
};

export async function loadLedger(log: SyncLogger, maps?: LedgerFlagAliases): Promise<Set<string>> {
  try {
    await ensurePdiSyncTables(log);
    const sql = `
      SELECT
        pdi_id,
        flag_code,
        flag_id,
        CAST(DATE(flag_entry_date) AS STRING) AS flag_date,
        CAST(DATE(flag_entry_date, 'America/Los_Angeles') AS STRING) AS flag_date_pacific,
        CAST(TIME(flag_entry_date) AS STRING) AS flag_time_utc
      FROM \`${BQ_FLAGS_TABLE}\`
      UNION DISTINCT
      SELECT
        pdi_id,
        flag_code,
        flag_id,
        CAST(flag_date AS STRING) AS flag_date,
        CAST(flag_date AS STRING) AS flag_date_pacific,
        '00:00:00' AS flag_time_utc
      FROM \`${BQ_LEDGER_TABLE}\`
      UNION DISTINCT
      SELECT
        pdi_id,
        flag_code,
        flag_id,
        CAST(flag_date AS STRING) AS flag_date,
        CAST(flag_date AS STRING) AS flag_date_pacific,
        '00:00:00' AS flag_time_utc
      FROM \`${BQ_FLAG_INSTANCES_TABLE}\`
    `;
    const rows = await runQuery<LedgerRow>(sql);
    const keys = new Set<string>();
    for (const r of rows) {
      const days = ledgerDaysForStoredFlag(
        fieldText(r.flag_date),
        fieldText(r.flag_date_pacific),
        fieldText(r.flag_time_utc)
      );
      const pdiId = fieldText(r.pdi_id);
      const flagId = fieldText(r.flag_id);
      for (const day of days) {
        addStoredFlagToLedger(keys, pdiId, fieldText(r.flag_code), day, maps);
        if (flagId) addStoredFlagToLedger(keys, pdiId, flagId, day, maps);
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
    return {
      ledger_key: ledgerKey(e.pdi_id, flagId || e.flag_code, e.flag_date),
      pdi_id: e.pdi_id,
      flag_code: e.flag_code,
      flag_id: flagId || null,
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
