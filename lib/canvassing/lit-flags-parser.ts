/**
 * Parse PDI flag exports of Lit Observation / flyer-receipt answers into knock-index rows.
 * Expected columns (case-insensitive): PDIID, FLAGENTRYDATE, RESPONSECODE /
 * RESPONSEDESCRIPTION, CANVASSERNAME, SURVEYQUESTIONSHORTTEXT, MOBILEPROJECTASSIGMENT.
 */
import { normalizeRecontactPersonId } from "../qc-recontact/ids";
import type { QcCanvassKnockIndexRow } from "../qc-recontact/types";
import { canonical } from "./doorknocks-results/helpers";
import { parseCsvTable, tableToRecords } from "./knock-details-parser";
import {
  classifyFlyerAnswer,
  classifyLitObservation,
  isFlyerReceiptQuestion,
  isLitObservationQuestion,
  type FlyerAnswer,
  type LitObservation,
} from "./lit-qc";

export type LitFlagsParseIssue = {
  rowNumber: number;
  message: string;
};

export type LitFlagsParseResult = {
  rows: Omit<QcCanvassKnockIndexRow, "reportId">[];
  litRows: number;
  flyerRows: number;
  skippedOther: number;
  skippedNoPrimaryId: number;
  skippedUnclassified: number;
  issues: LitFlagsParseIssue[];
};

const REQUIRED_HEADERS = ["PDIID", "FLAGENTRYDATE", "CANVASSERNAME"] as const;
const LIT_QUESTION = "Lit Observation";
const FLYER_QUESTION = "Did you receive our flyer?";

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

export function classifyFlyerFlagCode(code: string): FlyerAnswer | null {
  const value = canonical(code);
  if (!value) return null;
  if (value === "gf" || value === "got flyer" || value === "got a flyer") return "got";
  if (value === "dgf" || value === "didnt get flyer" || value === "didn t get flyer") return "didnt";
  if (value === "und" || value === "undecided") return "undecided";
  return null;
}

export function classifyFlyerFlagAnswer(responseDescription: string, responseCode: string): FlyerAnswer | null {
  return classifyFlyerAnswer(responseDescription) ?? classifyFlyerFlagCode(responseCode) ?? classifyFlyerAnswer(responseCode);
}

function stableLitResponse(lit: LitObservation, description: string): string {
  const trimmed = description.trim();
  if (trimmed && classifyLitObservation(trimmed) === lit) return trimmed;
  if (lit === "saw") return "Saw Lit";
  if (lit === "didnt") return "Didn't See Lit";
  return "HH has USA Flag";
}

function stableFlyerResponse(flyer: FlyerAnswer, description: string): string {
  const trimmed = description.trim();
  if (trimmed && classifyFlyerAnswer(trimmed) === flyer) return trimmed;
  if (flyer === "got") return "Got a Flyer";
  if (flyer === "didnt") return "Didn't Get Flyer";
  return "Undecided";
}

type FlagKind = "lit" | "flyer";

function detectFlagKind(question: string, code: string, description: string): FlagKind | null {
  if (question && isLitObservationQuestion(question)) return "lit";
  if (question && isFlyerReceiptQuestion(question)) return "flyer";
  // Blank short-text: classify from code/description (lit first when both could match).
  if (!question) {
    if (classifyLitFlagAnswer(description, code)) return "lit";
    if (classifyFlyerFlagAnswer(description, code)) return "flyer";
  }
  return null;
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
    const need: string[] = [...missing];
    if (!hasAnswer) need.push("RESPONSEDESCRIPTION or RESPONSECODE");
    throw new Error(`Lit flags CSV is missing required columns: ${need.join(", ")}.`);
  }

  const rows: Omit<QcCanvassKnockIndexRow, "reportId">[] = [];
  const issues: LitFlagsParseIssue[] = [];
  let litRows = 0;
  let flyerRows = 0;
  let skippedOther = 0;
  let skippedNoPrimaryId = 0;
  let skippedUnclassified = 0;
  const seen = new Set<string>();

  for (const record of records) {
    const rowNumber = Number(record.__rowNumber ?? 0) || 0;
    const question = cell(record, headers, "SURVEYQUESTIONSHORTTEXT");
    const code = cell(record, headers, "RESPONSECODE");
    const description = cell(record, headers, "RESPONSEDESCRIPTION");
    const kind = detectFlagKind(question, code, description);

    if (!kind) {
      skippedOther += 1;
      continue;
    }

    const primaryId = cell(record, headers, "PDIID");
    if (!normalizeRecontactPersonId(primaryId)) {
      skippedNoPrimaryId += 1;
      issues.push({ rowNumber, message: "Missing or invalid PDIID." });
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

    let storedQuestion = "";
    let response = "";
    if (kind === "lit") {
      const lit = classifyLitFlagAnswer(description, code);
      if (!lit) {
        skippedUnclassified += 1;
        issues.push({
          rowNumber,
          message: `Unrecognized lit answer (code="${code}", description="${description}").`,
        });
        continue;
      }
      storedQuestion = LIT_QUESTION;
      response = stableLitResponse(lit, description);
    } else {
      const flyer = classifyFlyerFlagAnswer(description, code);
      if (!flyer) {
        skippedUnclassified += 1;
        issues.push({
          rowNumber,
          message: `Unrecognized flyer answer (code="${code}", description="${description}").`,
        });
        continue;
      }
      storedQuestion = question && isFlyerReceiptQuestion(question) ? question : FLYER_QUESTION;
      response = stableFlyerResponse(flyer, description);
    }

    const dedupeKey = [
      normalizeRecontactPersonId(primaryId),
      occurredAt,
      kind === "lit" ? LIT_QUESTION : "flyer-receipt",
      response,
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (kind === "lit") litRows += 1;
    else flyerRows += 1;

    rows.push({
      primaryId,
      canvasserName,
      assignmentName,
      occurredAt,
      question: storedQuestion,
      response,
      sourceFileName,
    });
  }

  return {
    rows,
    litRows,
    flyerRows,
    skippedOther,
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
