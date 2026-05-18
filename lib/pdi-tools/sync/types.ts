export type SurveyResultRow = {
  callee_id?: string;
  call_time?: string | { value?: string };
  call_id?: string | number;
  caller_id?: string;
  phonebanker?: string;
  campaign_name?: string;
  question_name?: string;
  answer_value?: string;
  pdi_id?: string;
  _fill_source_question?: string;
  _synthetic_final_result?: boolean;
};

export type PdiFlagPayloadItem = {
  pdiId: string;
  questionId: string;
  flagId: string;
  acquisitionTypeId: string;
  flagEntryDate: string;
};

export type SyncRunOptions = {
  mode: "incremental" | "range";
  start?: string;
  end?: string;
  dryRun: boolean;
  minRecords: number;
  mappingFileId: string;
  rollbackRun?: string;
};

export type SyncRunSummary = {
  runId: string;
  engine: "typescript";
  exitCode: number;
  mappingFile: string | null;
  dateRange: { start: string; end: string };
  dryRun: boolean;
  rowsFromBq: number;
  syntheticFinalRows: number;
  payloadCount: number;
  rowsSkipped: number;
  /** Ledger duplicates + intra-batch duplicates (matches Python `rows_deduped`). */
  rowsDeduped: number;
  /** Subset of `rowsDeduped`: duplicate ledger keys seen again in this run before POST. */
  rowsDedupedSameBatch: number;
  rowsPosted: number;
  rowsFailed: number;
  ledgerSize: number;
};
