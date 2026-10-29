/**
 * Parse PDI flag exports of Lit Observation answers into knock-index rows.
 * Expected columns (case-insensitive): PDIID, FLAGENTRYDATE, RESPONSECODE /
 * RESPONSEDESCRIPTION, CANVASSERNAME, SURVEYQUESTIONSHORTTEXT, MOBILEPROJECTASSIGMENT.
 */
import { normalizeRecontactPersonId } from "../qc-recontact/ids";
import type { QcCanvassKnockIndexRow } from "../qc-recontact/types";
import { canonical } from "./doorknocks-results/helpers";
import { parseCsvTable, tableToRecords } from "./knock-details-parser";
import {
  classifyLitObservation,
  isLitObservationQuestion,
  type LitObservation,
} from "./lit-qc";

export type LitFlagsParseIssue = {
  rowNumber: number;
  message: string;
};

export type LitFlagsParseResult = {
  rows: Omit<QcCanvassKnockIndexRow, "reportId">[];
  litRows: number;
  skippedNotLit: number;
  skippedNoPrimaryId: number;
  skippedUnclassified: number;
  issues: LitFlagsParseIssue[];
};

const REQUIRED_HEADERS = ["PDIID", "FLAGENTRYDATE", "CANVASSERNAME"] as const;

function headerMap(columns: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const column of columns) {
    const key = canonical(column);
    if (key && !map.has(key)) map.set(key, column);
  }
  return map;
}

function cell(record: Record<string, string>, headers: Map<string, string>, name: string): string {
  const column = headers.get(canonical(name));
  if (!column) return "";
  return (record[column] ?? "").trim();
}

/** Map PDI RESPONSECODE values when the description is blank or unfamiliar. */
export function classifyLitFlagCode(code: string): LitObservation | null {
  const value = canonical(code);
  if (!value) return null;
  if (value === "nhnl" || value === "didnt see lit" || value === "didn t see lit") return "didnt";
  if (value === "nhyl" || value === "saw lit" || value === "not home saw lit") return "saw";
  if (value === "usa flag" || value === "hh has usa flag" || value === "nhuf") return "usaFlag";
  return null;
}

export function classifyLitFlagAnswer(responseDescription: string, responseCode: string): LitObservation | null {
  return classifyLitObservation(responseDescription) ?? classifyLitFlagCode(responseCode) ?? classifyLitObservation(responseCode);
}

function stableLitResponse(lit: LitObservation, description: string): string {
  const trimmed = description.trim();
  // Keep the export wording when Lit QC can classify it; otherwise use a stable label.
  if (trimmed && classifyLitObservation(trimmed) === lit) return trimmed;
  if (lit === "saw") return "Saw Lit";
  if (lit === "didnt") return "Didn't See Lit";
  return "HH has USA Flag";
}

function isLitFlagRow(question: string, code: string, description: string): boolean {
  if (question && isLitObservationQuestion(question)) return true;
  if (classifyLitFlagAnswer(description, code)) {
    // Accept code/description-only rows when the short-text column is blank.
    if (!question) return true;
  }
  return false;
}

export function parseLitFlagsCsv(csvText: string, sourceFileName = "lit-flags.csv"): LitFlagsParseResult {
  const table = parseCsvTable(csvText).filter((row) => row.some((value) => value.trim()));
  if (!table.length) {
    throw new Error("Lit flags file is empty.");
  }

  const { columns, records } = tableToRecords(table);
  const headers = headerMap(columns);
  const missing = REQUIRED_HEADERS.filter((name) => !headers.has(canonical(name)));
  const hasAnswer =
    headers.has(canonical("RESPONSEDESCRIPTION")) || headers.has(canonical("RESPONSECODE"));
  if (missing.length || !hasAnswer) {
    const need = [...missing];
    if (!hasAnswer) need.push("RESPONSEDESCRIPTION or RESPONSECODE");
    throw new Error(`Lit flags CSV is missing required columns: ${need.join(", ")}.`);
  }

  const rows: Omit<QcCanvassKnockIndexRow, "reportId">[] = [];
  const issues: LitFlagsParseIssue[] = [];
  let litRows = 0;
  let skippedNotLit = 0;
  let skippedNoPrimaryId = 0;
  let skippedUnclassified = 0;
  const seen = new Set<string>();

  for (const record of records) {
    const rowNumber = Number(record.__rowNumber ?? 0) || 0;
    const question = cell(record, headers, "SURVEYQUESTIONSHORTTEXT");
    const code = cell(record, headers, "RESPONSECODE");
    const description = cell(record, headers, "RESPONSEDESCRIPTION");

    if (!isLitFlagRow(question, code, description)) {
      skippedNotLit += 1;
      continue;
    }

    const primaryId = cell(record, headers, "PDIID");
    if (!normalizeRecontactPersonId(primaryId)) {
      skippedNoPrimaryId += 1;
      issues.push({ rowNumber, message: "Missing or invalid PDIID." });
      continue;
    }

    const lit = classifyLitFlagAnswer(description, code);
    if (!lit) {
      skippedUnclassified += 1;
      issues.push({
        rowNumber,
        message: `Unrecognized lit answer (code="${code}", description="${description}").`,
      });
      continue;
    }

    const canvasserName = cell(record, headers, "CANVASSERNAME");
    if (!canvasserName) {
      issues.push({ rowNumber, message: "Missing CANVASSERNAME; row kept with blank QC canvasser." });
    }

    const occurredAt = cell(record, headers, "FLAGENTRYDATE");
    if (!occurredAt) {
      skippedUnclassified += 1;
      issues.push({ rowNumber, message: "Missing FLAGENTRYDATE." });
      continue;
    }

    const assignmentName =
      cell(record, headers, "MOBILEPROJECTASSIGMENT") ||
      cell(record, headers, "MOBILEPROJECTASSIGNMENT");
    const response = stableLitResponse(lit, description);
    const dedupeKey = [
      normalizeRecontactPersonId(primaryId),
      occurredAt,
      "Lit Observation",
      response,
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    litRows += 1;
    rows.push({
      primaryId,
      canvasserName,
      assignmentName,
      occurredAt,
      question: "Lit Observation",
      response,
      sourceFileName,
    });
  }

  return {
    rows,
    litRows,
    skippedNotLit,
    skippedNoPrimaryId,
    skippedUnclassified,
    issues: issues.slice(0, 50),
  };
}

export function litFlagRowsToIndexRows(
  parsed: LitFlagsParseResult,
  reportId: string
): QcCanvassKnockIndexRow[] {
  return parsed.rows.map((row) => ({ ...row, reportId }));
}
