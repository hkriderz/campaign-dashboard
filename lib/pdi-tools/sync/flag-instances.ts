import { getBigQueryClient } from "@/lib/bigquery";
import { BQ_FLAG_INSTANCES_TABLE, LEDGER_INSERT_CHUNK } from "./constants";
import type { SyncLogger } from "./logger";

export type CreatedFlagInstanceRow = {
  run_id: string;
  instance_id: string;
  pdi_id: string;
  flag_id: string;
  flag_code: string;
  flag_date: string;
  created_at: string;
};

/** Streaming-insert flag instance IDs for rollback support (`stw_to_pdi._insert_flag_instances`). */
export async function insertFlagInstances(rows: CreatedFlagInstanceRow[], log: SyncLogger): Promise<void> {
  if (rows.length === 0) return;

  const bq = getBigQueryClient();
  const [, datasetId, tableId] = BQ_FLAG_INSTANCES_TABLE.split(".");
  const tbl = bq.dataset(datasetId!).table(tableId!);

  for (let i = 0; i < rows.length; i += LEDGER_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + LEDGER_INSERT_CHUNK);
    try {
      await tbl.insert(chunk);
    } catch (e) {
      log.warn(
        `Flag instances BQ insert error (chunk ${i / LEDGER_INSERT_CHUNK + 1}): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  log.info(`Stored ${rows.length} flag instance ID(s) to BQ`);
}
