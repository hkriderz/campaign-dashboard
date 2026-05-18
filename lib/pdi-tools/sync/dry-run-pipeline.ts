import { runQuery } from "@/lib/bigquery";
import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";
import { applyPdiToolsEnv } from "./apply-env";
import { fillFinalResults } from "./fill-final";
import { loadLedger } from "./ledger";
import { SyncLogger } from "./logger";
import { loadMappingForSync } from "./mapping";
import { buildSurveyQuery } from "./query";
import { loadSyncState } from "./sync-state";
import { buildMappingReport } from "./sync-reports";
import type { SurveyResultRow, SyncRunOptions } from "./types";

export type DryRunCounts = {
  mappingFile: string;
  dateRange: { start: string; end: string };
  bqRowsRaw: number;
  bqRowsAfterFill: number;
  syntheticFinalRows: number;
  payloadCount: number;
  rowsSkipped: number;
  rowsDeduped: number;
  rowsDedupedSameBatch: number;
  ledgerSize: number;
};
function formatQueryDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function resolveDateRange(
  options: SyncRunOptions
): Promise<{ startStr: string; endStr: string }> {
  const syncState = await loadSyncState(new SyncLogger());
  if (options.mode === "incremental") {
    const start = new Date(syncState.last_sync_timestamp);
    const end = new Date();
    return { startStr: formatQueryDateTime(start), endStr: formatQueryDateTime(end) };
  }
  if (!options.start?.trim()) {
    throw new Error("For range mode, start date (YYYY-MM-DD) is required.");
  }
  const start = new Date(`${options.start.trim()}T00:00:00`);
  const end = options.end?.trim()
    ? new Date(`${options.end.trim()}T23:59:59`)
    : new Date();
  return { startStr: formatQueryDateTime(start), endStr: formatQueryDateTime(end) };
}

/** Runs BQ → fill → transform without posting (for parity checks and tests). */
export async function computeDryRunCounts(options: SyncRunOptions): Promise<DryRunCounts> {
  applyPdiToolsEnv();
  const creds = resolvePdiToolsCredentials();
  if (!creds.gcpCredentialsPath) {
    throw new Error("GCP credentials not configured for BigQuery.");
  }

  const maps = loadMappingForSync(options.mappingFileId);
  const { startStr, endStr } = await resolveDateRange(options);
  const query = buildSurveyQuery(startStr, endStr);
  const rows = await runQuery<SurveyResultRow>(query);
  const { rows: filledRows, synthetic } = fillFinalResults(rows, maps, new SyncLogger());
  const ledger = await loadLedger(new SyncLogger());
  const { payload, rowsSkipped, rowsDeduped, rowsDedupedSameBatch } = buildMappingReport(
    filledRows,
    maps,
    ledger
  );

  return {
    mappingFile: maps.mappingFilePath,
    dateRange: { start: startStr, end: endStr },
    bqRowsRaw: rows.length,
    bqRowsAfterFill: filledRows.length,
    syntheticFinalRows: synthetic.length,
    payloadCount: payload.length,
    rowsSkipped,
    rowsDeduped,
    rowsDedupedSameBatch,
    ledgerSize: ledger.size,
  };}
