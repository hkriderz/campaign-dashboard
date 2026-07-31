import "server-only";

import path from "path";
import { DateTime } from "luxon";
import {
  CANVASSER_ALIASES,
  buildKnockEvents,
  compareCanvasserNames,
  detectReportDate,
  headerLookup,
  parseCanvassingUploadFile,
  parseDateTime,
  titleCaseName,
} from "./knock-details-parser";
import type {
  CampaignResultCanvasser,
  CampaignResultSummary,
  CanvasserGapStats,
  CanvassingGapDetail,
  CanvassingKnockEvent,
  CanvassingParsedFile,
  CanvassingReportResult,
  CanvassingValidationIssue,
} from "./types";

const NORMAL_GAP_MINUTES = 10;
const BIG_GAP_MINUTES = 30;
const HOUR_GAP_MINUTES = 60;
const OUTLIER_GAP_MINUTES = 120;

// Re-export parse helpers so existing API consumers keep working.
export { parseCanvassingUploadFile, parseDateTime };

function isLikelyContactResponse(response: string): boolean {
  const normalized = response.trim().toLowerCase();
  if (!normalized) return false;
  return !/(not home|no answer|answering machine|voicemail|wrong number|moved|deceased|refused|declined|dnc|do not contact|language)/i.test(
    normalized
  );
}

function roundMinutes(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isIdentityColumn(column: string): boolean {
  return /(name|canvasser|volunteer|caller|date|time|phone|email|id|assignment|campaign|turf|precinct|total\s*row)/i.test(
    column
  );
}

function campaignNameFromFile(fileName: string, sheetName?: string): string {
  const base = path.basename(fileName).replace(/\.(csv|xlsx)$/i, "").replace(/[-_]+/g, " ").trim();
  if (sheetName && !/^sheet\d+$/i.test(sheetName)) return `${base} - ${sheetName}`;
  return base || fileName;
}

function buildGapAnalysis(events: CanvassingKnockEvent[]): {
  canvasserStats: CanvasserGapStats[];
  gapDetails: CanvassingGapDetail[];
  bigGapDetails: CanvassingGapDetail[];
  hourGapDetails: CanvassingGapDetail[];
  outlierGapDetails: CanvassingGapDetail[];
} {
  const byCanvasser = new Map<string, CanvassingKnockEvent[]>();
  for (const event of events) {
    const group = byCanvasser.get(event.canvasserName) ?? [];
    group.push(event);
    byCanvasser.set(event.canvasserName, group);
  }

  const canvasserStats: CanvasserGapStats[] = [];
  const gapDetails: CanvassingGapDetail[] = [];
  const bigGapDetails: CanvassingGapDetail[] = [];
  const hourGapDetails: CanvassingGapDetail[] = [];
  const outlierGapDetails: CanvassingGapDetail[] = [];

  for (const [canvasserName, group] of byCanvasser.entries()) {
    const sorted = [...group].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const positiveGaps: number[] = [];
    const contactEndingGaps: number[] = [];
    let largestGapMinutes = 0;
    let largestGapStartAt: string | null = null;
    let largestGapEndAt: string | null = null;
    let totalGapMinutesOver10 = 0;
    let gapCountOver10 = 0;
    let bigGapCountOver30 = 0;
    let hourGapCount = 0;
    let outlierGapCount = 0;

    for (let index = 0; index < sorted.length - 1; index++) {
      const current = sorted[index]!;
      const next = sorted[index + 1]!;
      const start = DateTime.fromISO(current.occurredAt);
      const end = DateTime.fromISO(next.occurredAt);
      const gapMinutes = end.diff(start, "minutes").minutes;
      if (!Number.isFinite(gapMinutes) || gapMinutes <= 0) continue;

      positiveGaps.push(gapMinutes);
      if (isLikelyContactResponse(next.response)) contactEndingGaps.push(gapMinutes);
      if (gapMinutes > largestGapMinutes) {
        largestGapMinutes = gapMinutes;
        largestGapStartAt = current.occurredAt;
        largestGapEndAt = next.occurredAt;
      }

      if (gapMinutes > NORMAL_GAP_MINUTES) {
        gapCountOver10++;
        totalGapMinutesOver10 += gapMinutes;
        const isBigGap = gapMinutes > BIG_GAP_MINUTES;
        const isHourGap = gapMinutes >= HOUR_GAP_MINUTES;
        const isOutlierGap = gapMinutes >= OUTLIER_GAP_MINUTES;
        const detail: CanvassingGapDetail = {
          canvasserName,
          startAt: current.occurredAt,
          endAt: next.occurredAt,
          gapMinutes: roundMinutes(gapMinutes),
          isBigGap,
          isHourGap,
          isOutlierGap,
          startVoter: current.voter,
          endVoter: next.voter,
          endResponse: next.response,
          sourceFileName: next.sourceFileName,
        };
        gapDetails.push(detail);
        if (isBigGap) {
          bigGapCountOver30++;
          bigGapDetails.push(detail);
        }
        if (isHourGap) {
          hourGapCount++;
          hourGapDetails.push(detail);
        }
        if (isOutlierGap) {
          outlierGapCount++;
          outlierGapDetails.push(detail);
        }
      }
    }

    canvasserStats.push({
      canvasserName,
      knockCount: sorted.length,
      firstKnockAt: sorted[0]?.occurredAt ?? null,
      mostRecentKnockAt: sorted[sorted.length - 1]?.occurredAt ?? null,
      largestGapMinutes: roundMinutes(largestGapMinutes),
      largestGapStartAt,
      largestGapEndAt,
      totalGapMinutesOver10: roundMinutes(totalGapMinutesOver10),
      averageNonZeroGapMinutes: positiveGaps.length
        ? roundMinutes(positiveGaps.reduce((sum, gap) => sum + gap, 0) / positiveGaps.length)
        : 0,
      averageGapEndingInContactMinutes: contactEndingGaps.length
        ? roundMinutes(contactEndingGaps.reduce((sum, gap) => sum + gap, 0) / contactEndingGaps.length)
        : null,
      gapCountOver10,
      bigGapCountOver30,
      hourGapCount,
      outlierGapCount,
    });
  }

  canvasserStats.sort((a, b) => compareCanvasserNames(a.canvasserName, b.canvasserName));
  const byGapDesc = (a: CanvassingGapDetail, b: CanvassingGapDetail) =>
    b.gapMinutes - a.gapMinutes || a.canvasserName.localeCompare(b.canvasserName);
  gapDetails.sort(byGapDesc);
  bigGapDetails.sort(byGapDesc);
  hourGapDetails.sort(byGapDesc);
  outlierGapDetails.sort(byGapDesc);

  return { canvasserStats, gapDetails, bigGapDetails, hourGapDetails, outlierGapDetails };
}

function buildCampaignResults(parsedFiles: CanvassingParsedFile[]): {
  campaignResults: CampaignResultSummary[];
  issues: CanvassingValidationIssue[];
} {
  const campaignResults: CampaignResultSummary[] = [];
  const issues: CanvassingValidationIssue[] = [];

  for (const parsed of parsedFiles.filter((file) => file.sourceFile.role === "campaign_results")) {
    const lookup = headerLookup(parsed.sourceFile.columns);
    const canvasserColumn = CANVASSER_ALIASES.map((alias) => lookup.get(alias)).find(Boolean);

    if (!canvasserColumn) {
      issues.push({
        severity: "error",
        code: "missing_campaign_canvasser",
        message: "Campaign result file was detected but no canvasser-name column could be found.",
        fileName: parsed.sourceFile.originalName,
        sheetName: parsed.sourceFile.sheetName,
      });
      continue;
    }

    const resultColumns = parsed.sourceFile.columns.filter((column) => {
      if (column === canvasserColumn || column.startsWith("__") || isIdentityColumn(column)) return false;
      return parsed.rows.some((row) => parseNumber(row[column] ?? "") !== null);
    });

    if (!resultColumns.length) {
      issues.push({
        severity: "warning",
        code: "no_numeric_campaign_results",
        message: "Campaign result file has canvasser names but no numeric result columns were detected.",
        fileName: parsed.sourceFile.originalName,
        sheetName: parsed.sourceFile.sheetName,
      });
      continue;
    }

    const byCanvasser = new Map<string, CampaignResultCanvasser>();
    const totals: Record<string, number> = Object.fromEntries(resultColumns.map((column) => [column, 0]));

    for (const row of parsed.rows) {
      const canvasserName = titleCaseName(row[canvasserColumn]?.trim() ?? "");
      if (!canvasserName || canvasserName === "TOTAL") continue;

      const current = byCanvasser.get(canvasserName) ?? {
        canvasserName,
        totals: Object.fromEntries(resultColumns.map((column) => [column, 0])),
      };

      for (const column of resultColumns) {
        const value = parseNumber(row[column] ?? "") ?? 0;
        current.totals[column] += value;
        totals[column] += value;
      }

      byCanvasser.set(canvasserName, current);
    }

    campaignResults.push({
      campaignName: campaignNameFromFile(parsed.sourceFile.originalName, parsed.sourceFile.sheetName),
      fileName: parsed.sourceFile.originalName,
      sheetName: parsed.sourceFile.sheetName,
      rowCount: parsed.rows.length,
      canvasserCount: byCanvasser.size,
      resultColumns,
      totals,
      canvassers: [...byCanvasser.values()].sort((a, b) => a.canvasserName.localeCompare(b.canvasserName)),
    });
  }

  return { campaignResults, issues };
}

export function analyzeCanvassingParsedFiles(parsedFiles: CanvassingParsedFile[]): CanvassingReportResult {
  const sourceFiles = parsedFiles.map((file) => file.sourceFile);
  const validationIssues: CanvassingValidationIssue[] = [];

  for (const file of sourceFiles) {
    for (const warning of file.warnings) {
      validationIssues.push({
        severity: "warning",
        code: "file_warning",
        message: warning,
        fileName: file.originalName,
        sheetName: file.sheetName,
      });
    }
    if (file.role === "unknown") {
      validationIssues.push({
        severity: "warning",
        code: "unknown_file_role",
        message: "File could not be classified as knock details or campaign results.",
        fileName: file.originalName,
        sheetName: file.sheetName,
      });
    }
  }

  const knock = buildKnockEvents(parsedFiles);
  validationIssues.push(...knock.issues);
  const gaps = buildGapAnalysis(knock.events);
  const campaign = buildCampaignResults(parsedFiles);
  validationIssues.push(...campaign.issues);

  const totalGapMinutesOver10 = gaps.canvasserStats.reduce((sum, row) => sum + row.totalGapMinutesOver10, 0);
  const largestGapMinutes = gaps.canvasserStats.reduce((max, row) => Math.max(max, row.largestGapMinutes), 0);
  const detectedReportDate = detectReportDate(knock.events);

  return {
    sourceFiles,
    summary: {
      detectedReportDate,
      totalSourceFiles: sourceFiles.length,
      knockDetailFiles: sourceFiles.filter((file) => file.role === "knock_details").length,
      campaignResultFiles: sourceFiles.filter((file) => file.role === "campaign_results").length,
      unknownFiles: sourceFiles.filter((file) => file.role === "unknown").length,
      totalKnockRows: knock.totalRows,
      validKnockEvents: knock.events.length,
      invalidKnockRows: knock.totalRows - knock.events.length,
      totalCanvassers: gaps.canvasserStats.length,
      gapsOver10: gaps.gapDetails.length,
      bigGapsOver30: gaps.bigGapDetails.length,
      gapsOver60: gaps.hourGapDetails.length,
      outlierGapsOver120: gaps.outlierGapDetails.length,
      totalGapMinutesOver10: roundMinutes(totalGapMinutesOver10),
      largestGapMinutes: roundMinutes(largestGapMinutes),
    },
    canvasserStats: gaps.canvasserStats,
    gapDetails: gaps.gapDetails,
    bigGapDetails: gaps.bigGapDetails,
    hourGapDetails: gaps.hourGapDetails,
    outlierGapDetails: gaps.outlierGapDetails,
    campaignResults: campaign.campaignResults,
    validationIssues,
  };
}

export async function analyzeCanvassingUploads(
  files: Array<{ fileName: string; relativePath?: string; buffer: Buffer }>
): Promise<CanvassingReportResult> {
  const parsedGroups = await Promise.all(files.map((file) => parseCanvassingUploadFile(file)));
  return analyzeCanvassingParsedFiles(parsedGroups.flat());
}
