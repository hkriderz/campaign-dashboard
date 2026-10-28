import crypto from "crypto";
import path from "path";
import type {
  DoorknockCampaignDetection,
  DoorknockCampaignReport,
  DoorknockCanvasserRow,
  DoorknockNonContactColumn,
  DoorknockSourceFile,
  DoorknockSurveyAnswerColumn,
  DoorknockSurveyGroup,
} from "@/lib/canvassing/doorknocks-results/types";
import { cleanCanvasserName } from "@/lib/canvassing/display-names";
import { mergeCanvasserRows } from "@/lib/canvassing/doorknocks-results/helpers";
import { isNonContactGroupLabel, labelForPendingCode, segmentPendingFlagColumns, splitLeadingNonContact } from "./codes";

const TOTAL_LABELS = new Set(["canvassers", "total", "totals", "grand total"]);

const IDENTITY_HEADERS = new Set([
  "canvassername",
  "assignmentname",
  "totalhouses",
  "noncontactcount",
  "contactcount",
  "geocheck",
  "timingcheck",
  "lastsyn",
  "lastsync",
]);

function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function titleCaseName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function safeId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

function parseNumber(value: string | undefined): number {
  const cleaned = (value ?? "").replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsvTable(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (csvText[i + 1] === "\"") {
          current += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "\"") {
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

export function isGenericPendingApprovalName(fileName: string): boolean {
  const base = path.basename(fileName, path.extname(fileName)).trim();
  return /^pending\s*approval\s*report(?:\s*\(\d+\))?$/i.test(base);
}

export function assignmentCampaignPrefix(assignmentName: string): string {
  const trimmed = assignmentName.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1] ?? "";
    if (/\d/.test(tail) || /\bturf\b/i.test(tail)) {
      return parts.slice(0, -1).join(" - ").trim();
    }
  }
  return trimmed;
}

export function detectPendingReportDate(value: string): string | null {
  const match = value.match(/\b(\d{1,2})[-_/](\d{1,2})[-_/](\d{2,4})\b/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!month || !day || month > 12 || day > 31) return null;
  const rawYear = match[3] ?? "";
  const year = Number(rawYear.length === 2 ? `20${rawYear}` : rawYear);
  if (!year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mostCommon(values: string[]): { value: string; distinct: number } {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return { value: best, distinct: counts.size };
}

function campaignFromFileName(fileName: string): string {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePendingApprovalCsv(input: {
  fileName: string;
  relativePath?: string;
  buffer: Buffer;
}): { report: DoorknockCampaignReport | null; issues: string[] } {
  const issues: string[] = [];
  const text = input.buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const table = parseCsvTable(text).filter((row) => row.some((cell) => cell.trim()));
  if (table.length < 3) {
    return { report: null, issues: [`${input.fileName}: pending approval CSV needs a group header, a code header, and data rows.`] };
  }

  const width = Math.max(table[0]!.length, table[1]!.length);
  const groupRow = [...table[0]!];
  const codeRow = [...table[1]!];
  while (groupRow.length < width) groupRow.push("");
  while (codeRow.length < width) codeRow.push("");

  let currentGroup = "";
  const groups: string[] = [];
  const groupLabels: string[] = [];
  for (let index = 0; index < width; index++) {
    const label = groupRow[index]?.trim() ?? "";
    if (label) {
      currentGroup = label;
      groupLabels.push(label);
    }
    groups.push(currentGroup);
  }

  const headerIndex = (name: string) => codeRow.findIndex((cell) => canonical(cell) === name);
  const canvasserIndex = headerIndex("canvassername");
  const assignmentIndex = headerIndex("assignmentname");
  const doorsIndex = headerIndex("totalhouses");
  const contactsIndex = headerIndex("contactcount");
  const geoIndex = headerIndex("geocheck");
  const timingIndex = headerIndex("timingcheck");
  const lastSyncIndex = codeRow.findIndex((cell) => {
    const key = canonical(cell);
    return key === "lastsyn" || key === "lastsync";
  });

  if (canvasserIndex < 0) issues.push(`${input.fileName}: missing CanvasserName column.`);
  if (doorsIndex < 0) issues.push(`${input.fileName}: missing TotalHouses column.`);
  if (contactsIndex < 0) issues.push(`${input.fileName}: missing ContactCount column.`);

  const surveyByQuestion = new Map<string, DoorknockSurveyAnswerColumn[]>();
  const surveyColumns: DoorknockSurveyAnswerColumn[] = [];
  const nonContactColumns: DoorknockNonContactColumn[] = [];

  const flagCells = codeRow
    .map((rawCode, index) => ({ index, code: rawCode.trim() }))
    .filter((cell) => cell.code && !IDENTITY_HEADERS.has(canonical(cell.code)));
  const split = splitLeadingNonContact(flagCells, (columnIndex) => groups[columnIndex] ?? "");
  const restSegments = segmentPendingFlagColumns(split.rest);
  const nonContactCells = [
    ...split.nonContact,
    ...restSegments.filter((segment) => segment.kind === "canvass").flatMap((segment) => segment.codes),
  ];
  const questionSegments = restSegments.filter((segment) => segment.kind === "question");
  const questionLabels = groupLabels.filter((label) => !isNonContactGroupLabel(label));
  const canvassLabel = groupLabels.find((label) => isNonContactGroupLabel(label)) ?? "Canvass results";

  if (questionLabels.length !== questionSegments.length) {
    issues.push(
      `${input.fileName}: found ${questionLabels.length} question headers and ${questionSegments.length} answer groups. Titles are matched in order.`
    );
  }

  for (const cell of nonContactCells) {
    nonContactColumns.push({
      key: `nc:${cell.index}`,
      label: labelForPendingCode(cell.code),
      sourceHeader: `${canvassLabel} | ${cell.code}`,
    });
  }

  questionSegments.forEach((segment, segmentIndex) => {
    const question = questionLabels[segmentIndex]?.trim() || `Question ${segmentIndex + 1}`;
    for (const cell of segment.codes) {
      const column: DoorknockSurveyAnswerColumn = {
        key: `qa:${cell.index}`,
        question,
        answer: labelForPendingCode(cell.code),
      };
      surveyColumns.push(column);
      const existing = surveyByQuestion.get(question) ?? [];
      existing.push(column);
      surveyByQuestion.set(question, existing);
    }
  });

  const surveyGroups: DoorknockSurveyGroup[] = [...surveyByQuestion.entries()].map(([question, columns]) => ({
    question,
    columns,
  }));

  const rows: DoorknockCanvasserRow[] = [];
  const assignmentPrefixes: string[] = [];
  for (const cells of table.slice(2)) {
    const rawName = canvasserIndex >= 0 ? cells[canvasserIndex]?.trim() ?? "" : "";
    if (!rawName || TOTAL_LABELS.has(rawName.toLowerCase())) continue;
    const assignment = assignmentIndex >= 0 ? cells[assignmentIndex]?.trim() ?? "" : "";
    const prefix = assignmentCampaignPrefix(assignment);
    if (prefix) assignmentPrefixes.push(prefix);

    const surveyAnswers: Record<string, number> = {};
    const nonContacts: Record<string, number> = {};
    for (const column of surveyColumns) {
      const index = Number(column.key.slice("qa:".length));
      surveyAnswers[column.key] = parseNumber(cells[index]);
    }
    for (const column of nonContactColumns) {
      const index = Number(column.key.slice("nc:".length));
      nonContacts[column.key] = parseNumber(cells[index]);
    }
    const doorsKnocked = doorsIndex >= 0 ? parseNumber(cells[doorsIndex]) : 0;
    const contacts = contactsIndex >= 0 ? parseNumber(cells[contactsIndex]) : 0;
    rows.push({
      canvasserName: cleanCanvasserName(titleCaseName(rawName)),
      doorsKnocked,
      contacts,
      contactRate: doorsKnocked ? contacts / doorsKnocked : 0,
      surveyAnswers,
      nonContacts,
      ...(geoIndex >= 0 ? { geoCheck: cells[geoIndex]?.trim() ?? "" } : {}),
      ...(timingIndex >= 0 ? { timingCheck: cells[timingIndex]?.trim() ?? "" } : {}),
      ...(lastSyncIndex >= 0 ? { lastSync: cells[lastSyncIndex]?.trim() ?? "" } : {}),
    });
  }
  const mergedRows = mergeCanvasserRows(rows).sort((a, b) => a.canvasserName.localeCompare(b.canvasserName));

  const sourcePath = input.relativePath ?? input.fileName;
  const prefixStats = mostCommon(assignmentPrefixes);
  if (prefixStats.distinct > 1) {
    issues.push(`${input.fileName}: assignment names use ${prefixStats.distinct} campaign prefixes. Using "${prefixStats.value}".`);
  }

  const genericName = isGenericPendingApprovalName(sourcePath);
  const campaignName = genericName
    ? prefixStats.value || campaignFromFileName(sourcePath)
    : campaignFromFileName(sourcePath);
  const reportDate =
    detectPendingReportDate(prefixStats.value) ||
    detectPendingReportDate(assignmentPrefixes[0] ?? "") ||
    detectPendingReportDate(sourcePath);

  const detection: DoorknockCampaignDetection = {
    campaignId: safeId(campaignName),
    campaignName,
    confidence: genericName && prefixStats.value ? 0.8 : genericName ? 0.4 : 0.75,
    evidence: [
      genericName
        ? prefixStats.value
          ? `assignment prefix ${prefixStats.value}`
          : "generic PendingApprovalReport filename"
        : `filename ${campaignFromFileName(sourcePath)}`,
    ],
    candidateMentions: [],
    campaignCode: null,
  };

  const digest = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const sourceFile: DoorknockSourceFile = {
    id: crypto.createHash("sha1").update(`${sourcePath}:${digest}`).digest("hex").slice(0, 16),
    originalName: input.fileName,
    relativePath: sourcePath,
    sizeBytes: input.buffer.byteLength,
    checksum: digest,
    rowCount: mergedRows.length,
    columns: codeRow.map((cell, index) => cell.trim() || groups[index] || `Column ${index + 1}`),
  };

  const surveyAnswers = Object.fromEntries(surveyColumns.map((column) => [column.key, 0]));
  const nonContacts = Object.fromEntries(nonContactColumns.map((column) => [column.key, 0]));
  let doorsKnocked = 0;
  let contacts = 0;
  for (const row of mergedRows) {
    doorsKnocked += row.doorsKnocked;
    contacts += row.contacts;
    for (const column of surveyColumns) surveyAnswers[column.key] += row.surveyAnswers[column.key] ?? 0;
    for (const column of nonContactColumns) nonContacts[column.key] += row.nonContacts[column.key] ?? 0;
  }

  if (!surveyGroups.length) issues.push(`${input.fileName}: no survey question columns were detected.`);

  return {
    report: {
      id: sourceFile.id,
      campaignId: detection.campaignId,
      campaignName,
      reportDate,
      sourceFile,
      detection,
      rows: mergedRows,
      totals: {
        doorsKnocked,
        contacts,
        contactRate: doorsKnocked ? contacts / doorsKnocked : 0,
        surveyAnswers,
        nonContacts,
      },
      surveyGroups,
      nonContactColumns,
    },
    issues,
  };
}
