import { getBigQueryClient, executeSql } from "@/lib/bigquery";
import {
  BQ_FLAG_INSTANCES_TABLE,
  BQ_FLAGS_TABLE,
  BQ_LEDGER_TABLE,
  BQ_LOCK_TABLE,
  BQ_RUN_LOG_TABLE,
  BQ_SYNC_STATE_TABLE,
  PDI_DATASET,
} from "./constants";
import type { SyncLogger } from "./logger";

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS \`${BQ_LEDGER_TABLE}\` (
  ledger_key  STRING    NOT NULL,
  pdi_id      STRING    NOT NULL,
  flag_code   STRING    NOT NULL,
  flag_date   DATE      NOT NULL,
  synced_at   TIMESTAMP NOT NULL,
  source      STRING,
  run_id      STRING
)
PARTITION BY flag_date
CLUSTER BY pdi_id, flag_code
`;

const FLAGS_DDL = `
CREATE TABLE IF NOT EXISTS \`${BQ_FLAGS_TABLE}\` (
  pdi_id               STRING    NOT NULL,
  flag_code            STRING    NOT NULL,
  flag_entry_date      TIMESTAMP NOT NULL,
  flag_name            STRING,
  question_text        STRING,
  username             STRING,
  canvasser_name       STRING,
  first_name           STRING,
  last_name            STRING,
  acquisition_type     STRING,
  survey_name          STRING,
  precinct             STRING,
  refreshed_at         TIMESTAMP NOT NULL
)
PARTITION BY DATE(flag_entry_date)
CLUSTER BY pdi_id, flag_code
`;

const FLAGS_NEW_COLUMNS: Array<[string, string]> = [
  ["canvasser_name", "STRING"],
  ["first_name", "STRING"],
  ["last_name", "STRING"],
  ["acquisition_type", "STRING"],
  ["survey_name", "STRING"],
  ["precinct", "STRING"],
];

const SYNC_STATE_DDL = `
CREATE TABLE IF NOT EXISTS \`${BQ_SYNC_STATE_TABLE}\` (
  state_key             STRING    NOT NULL,
  last_sync_timestamp   TIMESTAMP NOT NULL,
  records_processed     INT64     NOT NULL,
  date_range_start      TIMESTAMP,
  date_range_end        TIMESTAMP,
  success_flag          BOOL      NOT NULL,
  error_log             STRING,
  updated_at            TIMESTAMP NOT NULL,
  updated_by            STRING
)
`;

const RUN_LOG_DDL = `
CREATE TABLE IF NOT EXISTS \`${BQ_RUN_LOG_TABLE}\` (
  run_id            STRING    NOT NULL,
  started_at        TIMESTAMP NOT NULL,
  finished_at       TIMESTAMP,
  machine           STRING,
  user              STRING,
  mode              STRING,
  date_range_start  TIMESTAMP,
  date_range_end    TIMESTAMP,
  rows_from_bq      INT64,
  rows_deduped      INT64,
  rows_skipped      INT64,
  rows_posted       INT64,
  rows_failed       INT64,
  success_flag      BOOL,
  error_summary     STRING
)
PARTITION BY DATE(started_at)
`;

const LOCK_DDL = `
CREATE TABLE IF NOT EXISTS \`${BQ_LOCK_TABLE}\` (
  lock_key   STRING    NOT NULL,
  locked_by  STRING    NOT NULL,
  locked_at  TIMESTAMP NOT NULL
)
`;

const FLAG_INSTANCES_DDL = `
CREATE TABLE IF NOT EXISTS \`${BQ_FLAG_INSTANCES_TABLE}\` (
  run_id        STRING    NOT NULL,
  instance_id   STRING    NOT NULL,
  pdi_id        STRING    NOT NULL,
  flag_id       STRING    NOT NULL,
  flag_code     STRING    NOT NULL,
  flag_date     DATE      NOT NULL,
  created_at    TIMESTAMP NOT NULL
)
PARTITION BY flag_date
CLUSTER BY pdi_id, flag_code
`;

async function safeExec(sql: string, log: SyncLogger, label: string): Promise<void> {
  try {
    await executeSql(sql);
  } catch (e) {
    log.warn(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Ensure `PDI_BQ_DATASET` exists and shared PDI sync tables are present (matches `stw_to_pdi.ensure_bq_tables_exist`).
 */
export async function ensurePdiSyncTables(log: SyncLogger): Promise<void> {
  const bq = getBigQueryClient();

  try {
    const [exists] = await bq.dataset(PDI_DATASET).exists();
    if (!exists) {
      await bq.createDataset(PDI_DATASET);
      log.info(`Created BigQuery dataset ${PDI_DATASET}`);
    }
  } catch (e) {
    log.warn(`Could not ensure dataset ${PDI_DATASET}: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const ddl of [
    LEDGER_DDL,
    FLAGS_DDL,
    SYNC_STATE_DDL,
    RUN_LOG_DDL,
    LOCK_DDL,
    FLAG_INSTANCES_DDL,
  ]) {
    await safeExec(ddl, log, "BQ DDL");
  }

  for (const [col, dtype] of FLAGS_NEW_COLUMNS) {
    await safeExec(
      `ALTER TABLE \`${BQ_FLAGS_TABLE}\` ADD COLUMN IF NOT EXISTS ${col} ${dtype}`,
      log,
      `BQ ALTER ${col}`
    );
  }
}
