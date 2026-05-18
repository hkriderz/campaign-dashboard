import { getBigQueryClient, runQuery } from "@/lib/bigquery";
import { BQ_FLAGS_TABLE, BQ_LEDGER_TABLE, LEDGER_INSERT_CHUNK } from "./constants";
import type { SyncLogger } from "./logger";

export function ledgerKey(pdiId: string, flagCode: string, flagDate: string): string {
  return `${pdiId}|${flagCode.toUpperCase()}|${flagDate}`;
}

type LedgerRow = {
  pdi_id: string;
  flag_code: string;
  flag_date: string | { value?: string };
};

export async function loadLedger(log: SyncLogger): Promise<Set<string>> {
  try {
    const sql = `
      SELECT pdi_id, flag_code, DATE(flag_entry_date) AS flag_date
      FROM \`${BQ_FLAGS_TABLE}\`
      UNION DISTINCT
      SELECT pdi_id, flag_code, flag_date
      FROM \`${BQ_LEDGER_TABLE}\`
    `;
    const rows = await runQuery<LedgerRow>(sql);
    const keys = new Set<string>();
    for (const r of rows) {
      const date =
        typeof r.flag_date === "object" && r.flag_date?.value
          ? String(r.flag_date.value).slice(0, 10)
          : String(r.flag_date).slice(0, 10);
      keys.add(ledgerKey(String(r.pdi_id), String(r.flag_code), date));
    }
    log.info(`Loaded ${keys.size} dedup keys from BQ (${BQ_FLAGS_TABLE} + ${BQ_LEDGER_TABLE})`);
    return keys;
  } catch (e) {
    log.warn(`BQ ledger load failed: ${e instanceof Error ? e.message : String(e)}. Starting with empty ledger.`);
    return new Set();
  }
}

export async function appendLedgerEntries(
  entries: Array<{ pdi_id: string; flag_code: string; flag_date: string }>,
  source: string,
  runId: string,
  log: SyncLogger
): Promise<void> {
  if (entries.length === 0) return;

  const nowTs = new Date().toISOString();
  const rows = entries.map((e) => ({
    ledger_key: ledgerKey(e.pdi_id, e.flag_code, e.flag_date),
    pdi_id: e.pdi_id,
    flag_code: e.flag_code,
    flag_date: e.flag_date,
    synced_at: nowTs,
    source,
    run_id: runId,
  }));

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
