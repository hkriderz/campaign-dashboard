import { getBigQueryClient } from "@/lib/bigquery";
import * as os from "node:os";
import { BQ_RUN_LOG_TABLE } from "./constants";
import type { SyncLogger } from "./logger";

export type SyncRunLogPayload = {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  mode: string;
  dateRangeStart: Date | null;
  dateRangeEnd: Date | null;
  rowsFromBq: number;
  rowsDeduped: number;
  rowsSkipped: number;
  rowsPosted: number;
  rowsFailed: number;
  successFlag: boolean;
  errorSummary: string;
};

/**
 * Streaming-insert one row into `sync_run_log` (parity with `stw_to_pdi.append_sync_run_log`).
 */
export async function appendSyncRunLog(payload: SyncRunLogPayload, log: SyncLogger): Promise<void> {
  const user = process.env.USER ?? process.env.USERNAME ?? "unknown";

  const row = {
    run_id: payload.runId,
    started_at: payload.startedAt.toISOString(),
    finished_at: payload.finishedAt.toISOString(),
    machine: os.hostname(),
    user,
    mode: payload.mode,
    date_range_start: payload.dateRangeStart?.toISOString() ?? null,
    date_range_end: payload.dateRangeEnd?.toISOString() ?? null,
    rows_from_bq: payload.rowsFromBq,
    rows_deduped: payload.rowsDeduped,
    rows_skipped: payload.rowsSkipped,
    rows_posted: payload.rowsPosted,
    rows_failed: payload.rowsFailed,
    success_flag: payload.successFlag,
    error_summary: (payload.errorSummary || "").slice(0, 1000),
  };

  try {
    const bq = getBigQueryClient();
    const [, datasetId, tableId] = BQ_RUN_LOG_TABLE.split(".");
    const tbl = bq.dataset(datasetId!).table(tableId!);
    await tbl.insert([row]);
  } catch (e) {
    log.warn(`Failed to append sync run log: ${e instanceof Error ? e.message : String(e)}`);
  }
}
