/**
 * Detect and parse CSV uploads for the phone-bank CSV store.
 *
 * - **Google Sheet roster** (legacy layout): col0 = `Date`, col1 = phone bank, col2 = caller, …
 * - **Wide PB crosstab** (STW / Sheets pivot): includes `Caller Name` and `Date` headers (any column order).
 */
import { parsePhoneBankCsv, tokenizeCsvLine } from "./csv-parser";
import { widePbReportCsvToPhoneBankRows } from "./pb-wide-report-to-sheet-rows";
import type { PhoneBankCsvRow } from "./types";

export type PbCsvUploadKind = "google_sheet_roster" | "wide_pb_crosstab";

function firstNonEmptyLine(csvText: string): string | null {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t) return t.replace(/^\uFEFF/, "");
  }
  return null;
}

function normHeaderCell(s: string): string {
  return s.trim().replace(/\s+/g, " ").replace(/^\uFEFF/, "");
}

function headerRowCells(csvText: string): string[] {
  const line = firstNonEmptyLine(csvText);
  if (!line) return [];
  return tokenizeCsvLine(line).map((c) => normHeaderCell(c));
}

/** Inspect the header row only (first non-empty line). */
export function detectPbCsvUploadKind(csvText: string): PbCsvUploadKind {
  const cols = headerRowCells(csvText);
  if (!cols.length) return "google_sheet_roster";

  const c0 = cols[0] ?? "";
  const hasCallerName = cols.some((h) => /^caller name$/i.test(h));
  const hasDate = cols.some((h) => /^date$/i.test(h));

  // Google Sheets roster: Date is always the first column.
  if (/^date$/i.test(c0)) return "google_sheet_roster";

  // Wide PB crosstab: Caller Name + Date anywhere (STW/canvass exports often put script cols first).
  if (hasCallerName && hasDate) return "wide_pb_crosstab";

  // Legacy check: canonical wide layout (Caller Name, Date in cols 0–1).
  const c1 = cols[1] ?? "";
  if (/^caller name$/i.test(c0) && /^date$/i.test(c1)) return "wide_pb_crosstab";

  return "google_sheet_roster";
}

const PREVIEW_WIDE_PB_NAME = "(Wide PB preview)";

export type ParsePhoneBankCsvForUploadOpts = {
  /** Required for `wide_pb_crosstab` when not in preview mode. */
  widePhoneBankName?: string;
  /** When true, wide files use a placeholder phone bank name so preview can run without user input. */
  preview?: boolean;
};

/**
 * Parse upload text into {@link PhoneBankCsvRow} rows. Wide crosstab files need a dashboard
 * `widePhoneBankName` (all rows share it), except in {@link ParsePhoneBankCsvForUploadOpts.preview} mode.
 */
export function parsePhoneBankCsvForUpload(
  csvText: string,
  opts: ParsePhoneBankCsvForUploadOpts = {}
): PhoneBankCsvRow[] {
  const kind = detectPbCsvUploadKind(csvText);
  if (kind === "wide_pb_crosstab") {
    const name =
      opts.widePhoneBankName?.trim() ||
      (opts.preview ? PREVIEW_WIDE_PB_NAME : "");
    if (!name) {
      throw new Error(
        "This CSV is a wide phone-bank crosstab (headers “Caller Name”, “Date”, …). It is not the Google Sheets roster layout. Enter a **Phone bank name** below so all rows are stored under one campaign, or use the Scale-to-Win tab for raw STW → wide → import."
      );
    }
    return widePbReportCsvToPhoneBankRows(csvText, name).rows;
  }
  return parsePhoneBankCsv(csvText);
}
