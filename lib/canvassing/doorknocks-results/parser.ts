import "server-only";

import crypto from "crypto";
import path from "path";
import {
  DEFAULT_DOORKNOCK_SUMMARY_SETTINGS,
  type DoorknockSummarySettings,
  type DoorknockCampaignDetection,
  type DoorknockCampaignReport,
  type DoorknockCanvasserRow,
  type DoorknockNonContactColumn,
  type DoorknockSourceFile,
  type DoorknockSurveyAnswerColumn,
  type DoorknockSurveyGroup,
} from "./types";

const CANVASSER_TOTAL_LABELS = new Set(["canvassers", "total", "totals"]);

function checksum(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCaseName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
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

function parseNumber(value: string | undefined): number {
  const cleaned = (value ?? "").replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function detectReportDate(fileName: string): string | null {
  const base = path.basename(fileName);
  const match = base.match(/(?:^|[^0-9])(\d{1,2})[-_](\d{1,2})(?:[-_](\d{2,4}))?(?:[^0-9]|$)/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!month || !day || month > 12 || day > 31) return null;
  const currentYear = new Date().getFullYear();
  const rawYear = match[3];
  const year = rawYear ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear) : currentYear;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractCampaignCode(fileName: string): string | null {
  const base = path.basename(fileName).toLowerCase();
  const code = base.match(/\b(ad|cd|sd|hd|la|ca)[-_ ]?(\d{1,3})\b/);
  if (code) return `${code[1].toUpperCase()}${code[2]}`;
  return null;
}

function extractCandidateMentions(headers: string[]): string[] {
  const mentions = new Set<string>();
  for (const header of headers) {
    const question = header.split("|")[0]?.trim() ?? "";
    const patterns = [
      /support\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’.-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’.-]+){0,3})\s+for/i,
      /support\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’.-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’.-]+){0,3})(?:\?|\/|$)/i,
      /donate\s+(?:to|for)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’.-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’.-]+){0,3})/i,
      /sign.*support\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’.-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’.-]+){0,3})/i,
    ];
    for (const pattern of patterns) {
      const match = question.match(pattern);
      const raw = match?.[1]?.trim();
      if (!raw) continue;
      const cleaned = raw
        .replace(/\s+(for|para|state|assembly|governor|mayor|council).*$/i, "")
        .replace(/[?/].*$/, "")
        .trim();
      if (cleaned.split(/\s+/).length >= 2) mentions.add(titleCaseName(cleaned));
    }
  }
  return [...mentions];
}

function detectCampaign(fileName: string, headers: string[]): DoorknockCampaignDetection {
  const code = extractCampaignCode(fileName);
  const mentions = extractCandidateMentions(headers);
  const evidence: string[] = [];
  if (code) evidence.push(`filename contains ${code}`);
  for (const mention of mentions.slice(0, 3)) {
    evidence.push(`survey question mentions ${mention}`);
  }

  const candidate = mentions[0] ?? null;
  const baseName = path.basename(fileName).replace(/\.csv$/i, "").replace(/[_-]+/g, " ");
  const campaignName = [code, candidate].filter(Boolean).join(" - ") || titleCaseName(baseName);
  const confidence = Math.min(0.95, (code ? 0.45 : 0) + (candidate ? 0.4 : 0) + (mentions.length > 1 ? 0.1 : 0));

  return {
    campaignId: safeId(campaignName),
    campaignName,
    confidence,
    evidence,
    candidateMentions: mentions,
    campaignCode: code,
  };
}

function splitQuestionAnswer(header: string): { question: string; answer: string } | null {
  const parts = header.split("|");
  if (parts.length < 2) return null;
  const question = parts[0]?.trim();
  const answer = parts.slice(1).join("|").trim();
  if (!question || !answer) return null;
  return { question, answer };
}

function classifyColumns(headers: string[]): {
  surveyGroups: DoorknockSurveyGroup[];
  surveyColumns: DoorknockSurveyAnswerColumn[];
  nonContactColumns: DoorknockNonContactColumn[];
  doorsIndex: number;
  contactsIndex: number;
} {
  const doorsIndex = headers.findIndex((header) => canonical(header) === "doors knocked");
  const contactsIndex = headers.findIndex((header) => canonical(header) === "contacted total");
  const surveyByQuestion = new Map<string, DoorknockSurveyAnswerColumn[]>();
  const surveyColumns: DoorknockSurveyAnswerColumn[] = [];
  const nonContactColumns: DoorknockNonContactColumn[] = [];

  headers.forEach((header, index) => {
    const canon = canonical(header);
    if (!header.trim()) return;
    if (index === doorsIndex || index === contactsIndex) return;
    if (canon === "total" || canon === "contacted doors phones") return;
    if (canon.startsWith("contacted ")) return;

    const split = splitQuestionAnswer(header);
    if (!split) return;

    if (canon.startsWith("non contact")) {
      const col: DoorknockNonContactColumn = {
        key: `nc:${index}`,
        label: split.answer,
        sourceHeader: header,
      };
      nonContactColumns.push(col);
      return;
    }

    const col: DoorknockSurveyAnswerColumn = {
      key: `qa:${index}`,
      question: split.question,
      answer: split.answer,
    };
    surveyColumns.push(col);
    const group = surveyByQuestion.get(split.question) ?? [];
    group.push(col);
    surveyByQuestion.set(split.question, group);
  });

  return {
    surveyGroups: [...surveyByQuestion.entries()].map(([question, columns]) => ({ question, columns })),
    surveyColumns,
    nonContactColumns,
    doorsIndex,
    contactsIndex,
  };
}

function sumRecords(
  rows: DoorknockCanvasserRow[],
  surveyColumns: DoorknockSurveyAnswerColumn[],
  nonContactColumns: DoorknockNonContactColumn[]
): DoorknockCampaignReport["totals"] {
  const surveyAnswers: Record<string, number> = Object.fromEntries(surveyColumns.map((col) => [col.key, 0]));
  const nonContacts: Record<string, number> = Object.fromEntries(nonContactColumns.map((col) => [col.key, 0]));
  let doorsKnocked = 0;
  let contacts = 0;

  for (const row of rows) {
    doorsKnocked += row.doorsKnocked;
    contacts += row.contacts;
    for (const col of surveyColumns) surveyAnswers[col.key] += row.surveyAnswers[col.key] ?? 0;
    for (const col of nonContactColumns) nonContacts[col.key] += row.nonContacts[col.key] ?? 0;
  }

  return {
    doorsKnocked,
    contacts,
    contactRate: doorsKnocked ? contacts / doorsKnocked : 0,
    surveyAnswers,
    nonContacts,
  };
}

export function parseDoorknockCsvReport(input: {
  fileName: string;
  relativePath?: string;
  buffer: Buffer;
}): { report: DoorknockCampaignReport | null; issues: string[] } {
  const issues: string[] = [];
  const text = input.buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const table = parseCsvTable(text).filter((row) => row.some((cell) => cell.trim()));
  if (table.length < 2) {
    return { report: null, issues: [`${input.fileName}: CSV does not contain data rows.`] };
  }

  const headers = table[0]!.map((header, index) => header.trim() || `Column ${index + 1}`);
  const columns = classifyColumns(headers);
  if (columns.doorsIndex < 0) issues.push(`${input.fileName}: missing DOORS KNOCKED column.`);
  if (columns.contactsIndex < 0) issues.push(`${input.fileName}: missing CONTACTED | TOTAL column.`);

  const digest = checksum(input.buffer);
  const sourceFile: DoorknockSourceFile = {
    id: crypto.createHash("sha1").update(`${input.relativePath ?? input.fileName}:${digest}`).digest("hex").slice(0, 16),
    originalName: input.fileName,
    relativePath: input.relativePath ?? input.fileName,
    sizeBytes: input.buffer.byteLength,
    checksum: digest,
    rowCount: Math.max(0, table.length - 1),
    columns: headers,
  };

  const rows: DoorknockCanvasserRow[] = [];
  for (const cells of table.slice(1)) {
    const rawName = cells[0]?.trim() ?? "";
    const nameKey = rawName.toLowerCase();
    if (!rawName || CANVASSER_TOTAL_LABELS.has(nameKey)) continue;

    const surveyAnswers: Record<string, number> = {};
    const nonContacts: Record<string, number> = {};
    for (const col of columns.surveyColumns) {
      const index = Number(col.key.slice("qa:".length));
      surveyAnswers[col.key] = parseNumber(cells[index]);
    }
    for (const col of columns.nonContactColumns) {
      const index = Number(col.key.slice("nc:".length));
      nonContacts[col.key] = parseNumber(cells[index]);
    }

    const doorsKnocked = columns.doorsIndex >= 0 ? parseNumber(cells[columns.doorsIndex]) : 0;
    const contacts = columns.contactsIndex >= 0 ? parseNumber(cells[columns.contactsIndex]) : 0;
    rows.push({
      canvasserName: titleCaseName(rawName),
      doorsKnocked,
      contacts,
      contactRate: doorsKnocked ? contacts / doorsKnocked : 0,
      surveyAnswers,
      nonContacts,
    });
  }

  rows.sort((a, b) => a.canvasserName.localeCompare(b.canvasserName));

  const detection = detectCampaign(input.relativePath ?? input.fileName, headers);
  const reportDate = detectReportDate(input.relativePath ?? input.fileName);
  const report: DoorknockCampaignReport = {
    id: sourceFile.id,
    campaignId: detection.campaignId,
    campaignName: detection.campaignName,
    reportDate,
    sourceFile,
    detection,
    rows,
    totals: sumRecords(rows, columns.surveyColumns, columns.nonContactColumns),
    surveyGroups: columns.surveyGroups,
    nonContactColumns: columns.nonContactColumns,
  };

  if (!columns.surveyGroups.length) {
    issues.push(`${input.fileName}: no survey question/answer columns were detected.`);
  }

  return { report, issues };
}

export function normalizeDoorknockSettings(
  raw: Partial<DoorknockSummarySettings> | null | undefined
): DoorknockSummarySettings {
  const defaults = DEFAULT_DOORKNOCK_SUMMARY_SETTINGS;
  return {
    ...defaults,
    ...raw,
    lowDoorsThreshold: Number(raw?.lowDoorsThreshold ?? defaults.lowDoorsThreshold) || defaults.lowDoorsThreshold,
    lowDoorsMaxStrongSupport:
      Number(raw?.lowDoorsMaxStrongSupport ?? defaults.lowDoorsMaxStrongSupport) || defaults.lowDoorsMaxStrongSupport,
    lowContactRatePct: Number(raw?.lowContactRatePct ?? defaults.lowContactRatePct) || defaults.lowContactRatePct,
    surveySupportThresholdPct:
      Number(raw?.surveySupportThresholdPct ?? defaults.surveySupportThresholdPct) || defaults.surveySupportThresholdPct,
    nonContactOutlierMultiplier:
      Number(raw?.nonContactOutlierMultiplier ?? defaults.nonContactOutlierMultiplier) ||
      defaults.nonContactOutlierMultiplier,
    nonContactMinCount: Number(raw?.nonContactMinCount ?? defaults.nonContactMinCount) || defaults.nonContactMinCount,
    supportAnswerLabels: raw?.supportAnswerLabels?.length ? raw.supportAnswerLabels : defaults.supportAnswerLabels,
    strongSupportAnswerLabels: raw?.strongSupportAnswerLabels?.length
      ? raw.strongSupportAnswerLabels
      : defaults.strongSupportAnswerLabels,
    undecidedAnswerLabels: raw?.undecidedAnswerLabels?.length ? raw.undecidedAnswerLabels : defaults.undecidedAnswerLabels,
    ignoredNonContactLabels: raw?.ignoredNonContactLabels?.length
      ? raw.ignoredNonContactLabels
      : defaults.ignoredNonContactLabels,
    surveyQuestionScope: raw?.surveyQuestionScope === "all" ? "all" : "first",
  };
}
