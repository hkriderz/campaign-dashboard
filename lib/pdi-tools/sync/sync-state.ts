import os from "node:os";
import { runQuery } from "@/lib/bigquery";
import { BQ_SYNC_STATE_TABLE, DEFAULT_LOOKBACK_DAYS } from "./constants";
import type { SyncLogger } from "./logger";
import { escapeSqlStringLiteral } from "./sql-escape";

export type SyncState = {
  last_sync_timestamp: string;
  records_processed: number;
  date_range: { start: string; end: string } | null;
  success_flag: boolean;
  error_log: string[];
};

type BqSyncStateRow = {
  last_sync_timestamp: string | { value?: string };
  records_processed?: number;
  date_range_start?: string | { value?: string } | null;
  date_range_end?: string | { value?: string } | null;
  success_flag?: boolean;
  error_log?: string | null;
};

function toIsoString(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === "object" && val !== null && "value" in val) {
    return String((val as { value: string }).value);
  }
  return String(val);
}

function toDateOnly(val: unknown): string | null {
  if (!val) return null;
  return toIsoString(val).slice(0, 10);
}

export async function loadSyncState(log: SyncLogger): Promise<SyncState> {
  try {
    const rows = await runQuery<BqSyncStateRow>(
      `SELECT * FROM \`${BQ_SYNC_STATE_TABLE}\` WHERE state_key = 'global' LIMIT 1`
    );
    if (rows.length > 0) {
      const row = rows[0]!;
      const start = toDateOnly(row.date_range_start);
      const end = toDateOnly(row.date_range_end);
      log.debug("Loaded sync state from BQ");
      return {
        last_sync_timestamp: toIsoString(row.last_sync_timestamp),
        records_processed: Number(row.records_processed ?? 0),
        date_range: start && end ? { start, end } : null,
        success_flag: Boolean(row.success_flag),
        error_log: row.error_log ? JSON.parse(row.error_log) as string[] : [],
      };
    }
  } catch (e) {
    log.warn(`BQ sync state load failed: ${e instanceof Error ? e.message : String(e)}. Using defaults.`);
  }

  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - DEFAULT_LOOKBACK_DAYS);
  log.info(`Using default sync state (${DEFAULT_LOOKBACK_DAYS} days back): ${defaultStart.toISOString()}`);
  return {
    last_sync_timestamp: defaultStart.toISOString(),
    records_processed: 0,
    date_range: null,
    success_flag: false,
    error_log: [],
  };
}

export async function saveSyncState(state: SyncState, log: SyncLogger): Promise<void> {
  const dr = state.date_range;
  const machine = os.hostname();
  const user = process.env.USER || process.env.USERNAME || "unknown";

  try {
    await runQuery(`DELETE FROM \`${BQ_SYNC_STATE_TABLE}\` WHERE state_key = 'global'`);
  } catch {
    /* table may not exist yet */
  }

  const startVal = dr?.start ? `TIMESTAMP('${escapeSqlStringLiteral(dr.start)}')` : "NULL";
  const endVal = dr?.end ? `TIMESTAMP('${escapeSqlStringLiteral(dr.end)}')` : "NULL";
  const errorJson = escapeSqlStringLiteral(JSON.stringify(state.error_log ?? []));
  const updatedBy = escapeSqlStringLiteral(`${user}@${machine}`);

  const sql = `
    INSERT INTO \`${BQ_SYNC_STATE_TABLE}\`
    (state_key, last_sync_timestamp, records_processed, date_range_start, date_range_end,
     success_flag, error_log, updated_at, updated_by)
    VALUES (
      'global',
      TIMESTAMP('${escapeSqlStringLiteral(state.last_sync_timestamp)}'),
      ${state.records_processed},
      ${startVal},
      ${endVal},
      ${state.success_flag},
      '${errorJson}',
      CURRENT_TIMESTAMP(),
      '${updatedBy}'
    )
  `;

  try {
    await runQuery(sql);
    log.debug("Saved sync state to BQ");
  } catch (e) {
    log.warn(`BQ sync state save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
