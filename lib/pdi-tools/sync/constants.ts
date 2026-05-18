import { DATASET, PROJECT } from "@/lib/bigquery";

export const STW_PROJECT = PROJECT;
export const STW_DATASET = DATASET;
export const PDI_DATASET = process.env.PDI_BQ_DATASET ?? "l11_pdi";

export const SURVEY_TABLE = "survey_results_w_pdi_ids";

export const BQ_LEDGER_TABLE = `${STW_PROJECT}.${PDI_DATASET}.synced_flags_ledger`;
export const BQ_FLAGS_TABLE = `${STW_PROJECT}.${PDI_DATASET}.pdi_all_flags`;
export const BQ_SYNC_STATE_TABLE = `${STW_PROJECT}.${PDI_DATASET}.sync_state`;
export const BQ_RUN_LOG_TABLE = `${STW_PROJECT}.${PDI_DATASET}.sync_run_log`;
export const BQ_LOCK_TABLE = `${STW_PROJECT}.${PDI_DATASET}.sync_lock`;
export const BQ_FLAG_INSTANCES_TABLE = `${STW_PROJECT}.${PDI_DATASET}.created_flag_instances`;

/** Same acquisition type as `stw_to_pdi.py`. */
export const ACQUISITION_TYPE_ID = "w6we79BXkuCsBbb9QCyiLA==";

export const PDI_BATCH_SIZE = 200;
export const PDI_RETRY_BATCH_SIZE = 50;
export const LEDGER_INSERT_CHUNK = 500;

export const DEFAULT_MIN_RECORDS = 50;
export const DEFAULT_LOOKBACK_DAYS = 30;
