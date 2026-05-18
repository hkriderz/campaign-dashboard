import * as fs from "fs";
import * as path from "path";
import { ACQUISITION_TYPE_ID } from "./constants";
import { ensurePdiSyncExportsDir } from "../sync-working-dir";
import { ledgerKey } from "./ledger";
import { getFlag, getQuestionId, type MappingMaps } from "./mapping";
import type { SyncLogger } from "./logger";
import type { PdiFlagPayloadItem, SurveyResultRow } from "./types";
import { extractFlagDate } from "./transform";

export type MappingReportRow = {
  campaign_name: string;
  question_name: string;
  answer_value: string;
  pdi_id: string;
  /** BigQuery `calls.id`. */
  call_id: string;
  /** BigQuery `callees.id` (internal row id), not the voter PDI id. */
  callee_id: string;
  synthetic: boolean;
  fill_source_question: string;
  mapping_status: string;
  questionId: string;
  flagId: string;
  acquisitionTypeId: string;
  flagEntryDate: string;
};

function norm(x: unknown): string {
  if (x === null || x === undefined) return "";
  return String(x).trim();
}

function csvEscape(val: string): string {
  if (/[",\n\r]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function writeCsv(filePath: string, headers: string[], rows: Record<string, string | boolean>[]): void {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(String(row[h] ?? ""))).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

export function buildMappingReport(
  rows: SurveyResultRow[],
  maps: MappingMaps,
  ledger: Set<string>
): {
  report: MappingReportRow[];
  payload: PdiFlagPayloadItem[];
  rowsSkipped: number;
  rowsDeduped: number;
  rowsDedupedSameBatch: number;
} {
  const report: MappingReportRow[] = [];
  const payload: PdiFlagPayloadItem[] = [];
  let rowsSkipped = 0;
  let rowsDeduped = 0;
  let rowsDedupedSameBatch = 0;
  /** Ledger keys already queued for POST this run (intra-run dedupe). */
  const queuedSyncKeys = new Set<string>();
  /** First row's `call_id` per queued key — for duplicate messaging. */
  const queuedSyncFirstCallId = new Map<string, string>();

  for (const r of rows) {
    const survey = norm(r.campaign_name);
    const question = norm(r.question_name);
    const answer = norm(r.answer_value);
    const pdiId = norm(r.pdi_id || r.callee_id || r.caller_id);
    const callId = norm(r.call_id);
    const calleeRowId = norm(r.callee_id);

    const reportRow: MappingReportRow = {
      campaign_name: survey,
      question_name: question,
      answer_value: answer,
      pdi_id: pdiId,
      call_id: callId,
      callee_id: calleeRowId,
      synthetic: Boolean(r._synthetic_final_result),
      fill_source_question: norm(r._fill_source_question),
      mapping_status: "",
      questionId: "",
      flagId: "",
      acquisitionTypeId: "",
      flagEntryDate: "",
    };

    if (!pdiId) {
      reportRow.mapping_status = "UNMAPPED: No PDI ID";
      rowsSkipped += 1;
      report.push(reportRow);
      continue;
    }

    const qid = getQuestionId(maps, survey, question);
    if (!qid) {
      reportRow.mapping_status = "UNMAPPED: Question not in mapping";
      rowsSkipped += 1;
      report.push(reportRow);
      continue;
    }

    const flagId = getFlag(maps, survey, question, answer);
    if (!flagId) {
      reportRow.mapping_status = "UNMAPPED: Answer/flag not in mapping";
      rowsSkipped += 1;
      report.push(reportRow);
      continue;
    }

    const flagDateStr = extractFlagDate(r.call_time);
    const flagCode = maps.flagIdToCode.get(flagId) ?? flagId;
    const key = ledgerKey(pdiId, flagCode, flagDateStr);

    reportRow.questionId = qid;
    reportRow.flagId = flagId;
    reportRow.acquisitionTypeId = ACQUISITION_TYPE_ID;
    reportRow.flagEntryDate = flagDateStr;

    if (ledger.has(key)) {
      reportRow.mapping_status = "DUPLICATE: Already synced to PDI";
      rowsDeduped += 1;
      report.push(reportRow);
      continue;
    }

    if (queuedSyncKeys.has(key)) {
      const firstCall = queuedSyncFirstCallId.get(key) ?? "";
      const sameCall =
        callId !== "" && firstCall !== "" && callId === firstCall;
      reportRow.mapping_status = sameCall
        ? "DUPLICATE: Duplicate row in same sync batch with the same call_id"
        : "DUPLICATE: Duplicate row in same sync batch";
      rowsDedupedSameBatch += 1;
      rowsDeduped += 1;
      report.push(reportRow);
      continue;
    }

    reportRow.mapping_status = "MAPPED";
    queuedSyncKeys.add(key);
    queuedSyncFirstCallId.set(key, callId);
    payload.push({
      pdiId,
      questionId: qid,
      flagId,
      acquisitionTypeId: ACQUISITION_TYPE_ID,
      flagEntryDate: flagDateStr,
    });
    report.push(reportRow);
  }

  return { report, payload, rowsSkipped, rowsDeduped, rowsDedupedSameBatch };
}

export type WrittenSyncReports = {
  exportsDir: string;
  mappingReportPath: string;
  payloadPreviewPath: string;
  synthesisReportPath: string | null;
};

export function writeSyncCsvReports(
  opts: {
    runId: string;
    report: MappingReportRow[];
    payload: PdiFlagPayloadItem[];
    syntheticRows: SurveyResultRow[];
    syncWindowStart: string;
    syncWindowEnd: string;
  },
  log: SyncLogger
): WrittenSyncReports {
  const exportsDir = ensurePdiSyncExportsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);

  const mappingReportPath = path.join(exportsDir, `pdi_mapping_report_${stamp}.csv`);
  writeCsv(
    mappingReportPath,
    [
      "campaign_name",
      "question_name",
      "answer_value",
      "pdi_id",
      "call_id",
      "callee_id",
      "synthetic",
      "fill_source_question",
      "mapping_status",
      "questionId",
      "flagId",
      "acquisitionTypeId",
      "flagEntryDate",
    ],
    opts.report as unknown as Record<string, string | boolean>[]
  );
  log.info(`Saved mapping report to ${path.basename(mappingReportPath)} (${opts.report.length} rows)`);

  const payloadPreviewPath = path.join(exportsDir, `pdi_payload_preview_${stamp}.csv`);
  writeCsv(
    payloadPreviewPath,
    ["pdiId", "questionId", "flagId", "acquisitionTypeId", "flagEntryDate"],
    opts.payload.map((p) => ({
      pdiId: p.pdiId,
      questionId: p.questionId,
      flagId: p.flagId,
      acquisitionTypeId: p.acquisitionTypeId,
      flagEntryDate: p.flagEntryDate,
    }))
  );
  log.info(`Saved payload preview to ${path.basename(payloadPreviewPath)} (${opts.payload.length} rows)`);

  let synthesisReportPath: string | null = null;
  if (opts.syntheticRows.length > 0) {
    synthesisReportPath = path.join(exportsDir, `final_result_synthesis_${stamp}.csv`);
    writeCsv(
      synthesisReportPath,
      [
        "run_id",
        "sync_window_start",
        "sync_window_end",
        "call_id",
        "campaign_name",
        "pdi_id",
        "final_result_question",
        "synthesized_answer",
        "fill_source_question",
        "call_time",
        "flag_entry_date",
      ],
      opts.syntheticRows.map((r) => ({
        run_id: opts.runId,
        sync_window_start: opts.syncWindowStart,
        sync_window_end: opts.syncWindowEnd,
        call_id: String(r.call_id ?? ""),
        campaign_name: norm(r.campaign_name),
        pdi_id: norm(r.pdi_id || r.callee_id || r.caller_id),
        final_result_question: norm(r.question_name),
        synthesized_answer: norm(r.answer_value),
        fill_source_question: norm(r._fill_source_question),
        call_time: norm(r.call_time),
        flag_entry_date: extractFlagDate(r.call_time),
      }))
    );
    log.info(
      `Saved Final Result synthesis report to ${path.basename(synthesisReportPath)} (${opts.syntheticRows.length} rows)`
    );
  }

  return { exportsDir, mappingReportPath, payloadPreviewPath, synthesisReportPath };
}
