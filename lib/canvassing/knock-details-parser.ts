/**
 * Shared knock-detail CSV/XLSX parsing for canvassing tools.
 * Pure module — no `server-only` — so CLI and analyzers can reuse it.
 */
import crypto from "crypto";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import type {
  CanvassingFileFormat,
  CanvassingFileRole,
  CanvassingKnockEvent,
  CanvassingParsedFile,
  CanvassingSourceFile,
  CanvassingValidationIssue,
} from "./types";

export const LA_TIME_ZONE = "America/Los_Angeles";

const KNOCK_DETAIL_HEADERS = [
  "canvassername",
  "assignmentname",
  "voter",
  "primaryid",
  "phone",
  "datetime",
  "question",
  "response",
];

const CANVASSER_ALIASES = [
  "canvassername",
  "canvasser",
  "canvasserfull",
  "canvasserfullname",
  "callername",
  "name",
  "volunteer",
  "volunteername",
];

const DATE_TIME_FORMATS = [
  "M/d/yyyy h:mm:ss a",
  "M/d/yyyy h:mm a",
  "M/d/yy h:mm:ss a",
  "M/d/yy h:mm a",
  "M/d/yyyy H:mm:ss",
  "M/d/yyyy H:mm",
  "M/d/yy H:mm:ss",
  "M/d/yy H:mm",
  "yyyy-MM-dd H:mm:ss",
  "yyyy-MM-dd H:mm",
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm:ss.SSS",
];

const UNMARKED_12_HOUR_CORRECTION_FORMATS = [
  "M/d/yyyy H:mm:ss",
  "M/d/yyyy H:mm",
  "M/d/yy H:mm:ss",
  "M/d/yy H:mm",
  "yyyy-MM-dd H:mm:ss",
  "yyyy-MM-dd H:mm",
];

export function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function titleCaseName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (trimmed.toUpperCase() === "TOTAL") return "TOTAL";
  return trimmed.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

export function canvasserLastNameSortKey(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex >= 0) {
    const last = trimmed.slice(0, commaIndex).trim();
    const first = trimmed.slice(commaIndex + 1).trim();
    return `${last} ${first}`.toLowerCase();
  }
  const parts = trimmed.split(/\s+/);
  const last = parts.at(-1) ?? trimmed;
  const first = parts.slice(0, -1).join(" ");
  return `${last} ${first}`.toLowerCase();
}

export function compareCanvasserNames(a: string, b: string): number {
  return canvasserLastNameSortKey(a).localeCompare(canvasserLastNameSortKey(b));
}

export function checksum(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeSourceId(fileName: string, sheetName: string | undefined, digest: string): string {
  const base = `${fileName}:${sheetName ?? ""}:${digest.slice(0, 16)}`;
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 16);
}

function detectFormat(fileName: string): CanvassingFileFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return null;
}

function detectRole(columns: string[], sheetName?: string): CanvassingFileRole {
  const canonicalColumns = new Set(columns.map(canonical).filter(Boolean));
  const knockHeaderMatches = KNOCK_DETAIL_HEADERS.filter((header) => canonicalColumns.has(header)).length;
  if (knockHeaderMatches >= 5 && canonicalColumns.has("canvassername") && canonicalColumns.has("datetime")) {
    return "knock_details";
  }

  const hasCanvasser = CANVASSER_ALIASES.some((alias) => canonicalColumns.has(alias));
  const looksLikeResultsSheet =
    hasCanvasser &&
    columns.some((column) =>
      /(result|support|commit|contact|survey|knock|door|flyer|pledge|yes|no|undecided|moved|declined)/i.test(column)
    );
  if (looksLikeResultsSheet) return "campaign_results";

  if (sheetName && /canvasser details/i.test(sheetName) && knockHeaderMatches >= 4) {
    return "knock_details";
  }
  return "unknown";
}

export function parseCsvTable(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(current);
      current = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      if (ch === "\r" && csvText[i + 1] === "\n") i++;
    } else {
      current += ch;
    }
  }

  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function tableToRecords(
  table: string[][],
  headerRowIndex = 0
): { columns: string[]; records: Record<string, string>[] } {
  const rawHeaders = table[headerRowIndex] ?? [];
  const columns = rawHeaders.map((header, index) => header.trim() || `Column ${index + 1}`);
  const records = table.slice(headerRowIndex + 1).flatMap((cells, offset) => {
    if (!cells.some((cell) => cell.trim())) return [];
    const record: Record<string, string> = { __rowNumber: String(headerRowIndex + offset + 2) };
    columns.forEach((column, index) => {
      record[column] = cells[index]?.trim() ?? "";
    });
    return [record];
  });
  return { columns, records };
}

function excelCellToString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone: LA_TIME_ZONE }).toISO() ?? "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return String(value.result).trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }
  }
  return cell.text.trim();
}

function worksheetToTable(worksheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  const maxColumn = Math.max(worksheet.actualColumnCount, worksheet.columnCount, 1);
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let col = 1; col <= maxColumn; col++) {
      cells.push(excelCellToString(row.getCell(col)));
    }
    while (cells.length && !cells[cells.length - 1]?.trim()) cells.pop();
    if (cells.some((cell) => cell.trim())) rows.push(cells);
  });
  return rows;
}

export function findHeaderRowIndex(table: string[][]): number {
  const scanLimit = Math.min(table.length, 20);
  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < scanLimit; index++) {
    const columns = table[index] ?? [];
    const canonicalColumns = new Set(columns.map(canonical));
    const knockScore = KNOCK_DETAIL_HEADERS.filter((header) => canonicalColumns.has(header)).length * 3;
    const canvasserScore = CANVASSER_ALIASES.some((alias) => canonicalColumns.has(alias)) ? 4 : 0;
    const nonEmptyScore = Math.min(columns.filter((column) => column.trim()).length, 10);
    const score = knockScore + canvasserScore + nonEmptyScore;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function createSourceFile(params: {
  fileName: string;
  relativePath: string;
  format: CanvassingFileFormat;
  sheetName?: string;
  sizeBytes: number;
  checksum: string;
  rowCount: number;
  columns: string[];
  role: CanvassingFileRole;
  warnings?: string[];
}): CanvassingSourceFile {
  return {
    id: safeSourceId(params.relativePath || params.fileName, params.sheetName, params.checksum),
    originalName: params.fileName,
    relativePath: params.relativePath || params.fileName,
    format: params.format,
    role: params.role,
    sheetName: params.sheetName,
    sizeBytes: params.sizeBytes,
    checksum: params.checksum,
    rowCount: params.rowCount,
    columns: params.columns,
    warnings: params.warnings ?? [],
  };
}

export async function parseCanvassingUploadFile(input: {
  fileName: string;
  relativePath?: string;
  buffer: Buffer;
}): Promise<CanvassingParsedFile[]> {
  const format = detectFormat(input.fileName);
  if (!format) {
    const digest = checksum(input.buffer);
    return [
      {
        sourceFile: createSourceFile({
          fileName: input.fileName,
          relativePath: input.relativePath ?? input.fileName,
          format: "csv",
          sizeBytes: input.buffer.byteLength,
          checksum: digest,
          rowCount: 0,
          columns: [],
          role: "unknown",
          warnings: ["Unsupported file extension. Upload CSV or XLSX files."],
        }),
        rows: [],
      },
    ];
  }

  const digest = checksum(input.buffer);
  const relativePath = input.relativePath ?? input.fileName;

  if (format === "csv") {
    const text = input.buffer.toString("utf-8").replace(/^\uFEFF/, "");
    const table = parseCsvTable(text);
    const headerRowIndex = findHeaderRowIndex(table);
    const { columns, records } = tableToRecords(table, headerRowIndex);
    const role = detectRole(columns);
    return [
      {
        sourceFile: createSourceFile({
          fileName: input.fileName,
          relativePath,
          format,
          sizeBytes: input.buffer.byteLength,
          checksum: digest,
          rowCount: records.length,
          columns,
          role,
        }),
        rows: records,
      },
    ];
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const parsedSheets = workbook.worksheets.flatMap((worksheet) => {
    const table = worksheetToTable(worksheet);
    if (!table.length) return [];
    const headerRowIndex = findHeaderRowIndex(table);
    const { columns, records } = tableToRecords(table, headerRowIndex);
    const role = detectRole(columns, worksheet.name);
    return [
      {
        sourceFile: createSourceFile({
          fileName: input.fileName,
          relativePath,
          format,
          sheetName: worksheet.name,
          sizeBytes: input.buffer.byteLength,
          checksum: digest,
          rowCount: records.length,
          columns,
          role,
          warnings: role === "unknown" ? ["Sheet was not recognized as knock details or campaign results."] : [],
        }),
        rows: records,
      },
    ];
  });

  const knockDetailSheets = parsedSheets.filter((sheet) => sheet.sourceFile.role === "knock_details");
  if (knockDetailSheets.length > 0) {
    return knockDetailSheets;
  }

  const recognizedSheets = parsedSheets.filter((sheet) => sheet.sourceFile.role !== "unknown");
  if (recognizedSheets.length > 0) return recognizedSheets;
  return parsedSheets.slice(0, 1);
}

export function headerLookup(columns: string[]): Map<string, string> {
  return new Map(columns.map((column) => [canonical(column), column]));
}

export function getValue(row: Record<string, string>, lookup: Map<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const column = lookup.get(canonical(alias));
    if (column) return row[column]?.trim() ?? "";
  }
  return "";
}

export function parseDateTime(raw: string): { iso: string | null; confidence: number; warning?: string } {
  const value = raw.trim();
  if (!value) return { iso: null, confidence: 0, warning: "Missing datetime." };

  const iso = DateTime.fromISO(value, { zone: LA_TIME_ZONE });
  if (iso.isValid) return { iso: iso.toISO(), confidence: 0.99 };

  for (const format of DATE_TIME_FORMATS) {
    const parsed = DateTime.fromFormat(value, format, { zone: LA_TIME_ZONE });
    if (parsed.isValid) {
      const hasMeridiem = /a$/.test(format) || value.toLowerCase().includes("am") || value.toLowerCase().includes("pm");
      const needsPdiAfternoonCorrection =
        !hasMeridiem &&
        UNMARKED_12_HOUR_CORRECTION_FORMATS.includes(format) &&
        (parsed.hour > 1 || (parsed.hour === 1 && (parsed.minute > 0 || parsed.second > 0))) &&
        (parsed.hour < 8 || (parsed.hour === 8 && parsed.minute < 30));
      const corrected = needsPdiAfternoonCorrection ? parsed.plus({ hours: 12 }) : parsed;
      const confidence = hasMeridiem ? 0.95 : 0.9;
      return {
        iso: corrected.toISO(),
        confidence,
        warning:
          !hasMeridiem && parsed.hour === 1 && parsed.minute === 0 && parsed.second === 0
            ? "Datetime is exactly 1:00 without AM/PM; the legacy sheet flags this boundary as ambiguous."
            : undefined,
      };
    }
  }

  const jsDate = new Date(value);
  if (!Number.isNaN(jsDate.getTime())) {
    return {
      iso: DateTime.fromJSDate(jsDate, { zone: LA_TIME_ZONE }).toISO(),
      confidence: 0.55,
      warning: "Datetime was parsed by fallback JavaScript parsing; verify timezone and AM/PM interpretation.",
    };
  }

  return { iso: null, confidence: 0, warning: `Could not parse datetime "${value}".` };
}

export function detectReportDate(events: CanvassingKnockEvent[]): string | null {
  const counts = new Map<string, number>();
  for (const event of events) {
    const date = DateTime.fromISO(event.occurredAt, { zone: LA_TIME_ZONE }).toISODate();
    if (!date) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  let bestDate: string | null = null;
  let bestCount = 0;
  for (const [date, count] of counts.entries()) {
    if (count > bestCount) {
      bestDate = date;
      bestCount = count;
    }
  }
  return bestDate;
}

/** Distinct ISO calendar dates present in knock events, sorted ascending. */
export function detectDistinctReportDates(events: CanvassingKnockEvent[]): string[] {
  const dates = new Set<string>();
  for (const event of events) {
    const date = DateTime.fromISO(event.occurredAt, { zone: LA_TIME_ZONE }).toISODate();
    if (date) dates.add(date);
  }
  return [...dates].sort();
}

export function buildKnockEvents(parsedFiles: CanvassingParsedFile[]): {
  events: CanvassingKnockEvent[];
  issues: CanvassingValidationIssue[];
  totalRows: number;
} {
  const events: CanvassingKnockEvent[] = [];
  const issues: CanvassingValidationIssue[] = [];
  let totalRows = 0;

  for (const parsed of parsedFiles.filter((file) => file.sourceFile.role === "knock_details")) {
    const lookup = headerLookup(parsed.sourceFile.columns);

    for (const row of parsed.rows) {
      const sourceRowNumber = Number(row.__rowNumber ?? "0") || 0;
      const canvasserName = titleCaseName(getValue(row, lookup, ["CANVASSERNAME", "Canvasser Name", "Canvasser"]));
      const assignmentName = getValue(row, lookup, ["ASSIGNMENTNAME", "Assignment Name", "Assignment"]);
      const voter = getValue(row, lookup, ["VOTER", "Voter", "Voter Name"]);
      const primaryId = getValue(row, lookup, ["PRIMARYID", "Primary ID", "PrimaryId"]);
      const phone = getValue(row, lookup, ["PHONE", "Phone"]);
      const dateTimeRaw = getValue(row, lookup, ["DATETIME", "Date Time", "Date/Time", "Timestamp"]);
      const question = getValue(row, lookup, ["QUESTION", "Question"]);
      const response = getValue(row, lookup, ["RESPONSE", "Response", "Answer"]);

      if (![canvasserName, assignmentName, voter, primaryId, phone, dateTimeRaw, question, response].some(Boolean)) {
        continue;
      }

      totalRows++;
      const parsedDate = parseDateTime(dateTimeRaw);

      if (!canvasserName) {
        issues.push({
          severity: "error",
          code: "missing_canvasser",
          message: "Knock detail row is missing a canvasser name.",
          fileName: parsed.sourceFile.originalName,
          sheetName: parsed.sourceFile.sheetName,
          rowNumber: sourceRowNumber,
          field: "CANVASSERNAME",
        });
      }

      if (!parsedDate.iso) {
        issues.push({
          severity: "error",
          code: "invalid_datetime",
          message: parsedDate.warning ?? "Knock detail row has an invalid datetime.",
          fileName: parsed.sourceFile.originalName,
          sheetName: parsed.sourceFile.sheetName,
          rowNumber: sourceRowNumber,
          field: "DATETIME",
        });
      } else if (parsedDate.warning) {
        issues.push({
          severity: "warning",
          code: "low_confidence_datetime",
          message: parsedDate.warning,
          fileName: parsed.sourceFile.originalName,
          sheetName: parsed.sourceFile.sheetName,
          rowNumber: sourceRowNumber,
          field: "DATETIME",
        });
      }

      if (!canvasserName || !parsedDate.iso) continue;

      events.push({
        canvasserName,
        assignmentName,
        voter,
        primaryId,
        phone,
        dateTimeRaw,
        occurredAt: parsedDate.iso,
        parseConfidence: parsedDate.confidence,
        question,
        response,
        sourceFileId: parsed.sourceFile.id,
        sourceFileName: parsed.sourceFile.originalName,
        sourceRowNumber,
      });
    }
  }

  return { events, issues, totalRows };
}

export { CANVASSER_ALIASES, KNOCK_DETAIL_HEADERS };
