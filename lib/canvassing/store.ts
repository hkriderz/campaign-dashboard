import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  CanvassingGapDetail,
  CanvassingReportResult,
  SavedCanvassingReport,
  SavedCanvassingReportListItem,
} from "./types";

const DATA_ROOT = path.join(process.cwd(), "data", "canvassing-reports");
const REPORTS_DIR = path.join(DATA_ROOT, "reports");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureStoreDirs(): void {
  ensureDir(REPORTS_DIR);
}

function safeReportId(reportId: string): string {
  return reportId.replace(/[^a-z0-9_-]/gi, "");
}

function reportPath(reportId: string): string {
  return path.join(REPORTS_DIR, `${safeReportId(reportId)}.json`);
}

function hydrateGapDetail(
  gap: Partial<CanvassingGapDetail> &
    Pick<CanvassingGapDetail, "canvasserName" | "startAt" | "endAt" | "gapMinutes">
): CanvassingGapDetail {
  return {
    canvasserName: gap.canvasserName,
    startAt: gap.startAt,
    endAt: gap.endAt,
    gapMinutes: gap.gapMinutes,
    isBigGap: gap.isBigGap ?? gap.gapMinutes > 30,
    isHourGap: gap.isHourGap ?? gap.gapMinutes >= 60,
    isOutlierGap: gap.isOutlierGap ?? gap.gapMinutes >= 120,
    startVoter: gap.startVoter ?? "",
    endVoter: gap.endVoter ?? "",
    endResponse: gap.endResponse ?? "",
    sourceFileName: gap.sourceFileName ?? "",
  };
}

function hydrateReport(raw: Partial<SavedCanvassingReport>): SavedCanvassingReport | null {
  if (!raw.id || !raw.name || !raw.createdAt || !raw.updatedAt || !raw.summary) return null;
  const detectedReportDate = raw.summary.detectedReportDate ?? raw.reportDate ?? null;
  const gapDetails = (raw.gapDetails ?? []).map((gap) => hydrateGapDetail(gap));
  const bigGapDetails = (raw.bigGapDetails ?? []).map((gap) => hydrateGapDetail(gap));
  const hourGapDetails = (raw.hourGapDetails ?? gapDetails.filter((gap) => gap.gapMinutes >= 60)).map(
    (gap) => hydrateGapDetail(gap)
  );
  const outlierGapDetails = (
    raw.outlierGapDetails ?? gapDetails.filter((gap) => gap.gapMinutes >= 120)
  ).map((gap) => hydrateGapDetail(gap));
  const canvasserStats = (raw.canvasserStats ?? []).map((stat) => ({
    ...stat,
    hourGapCount: stat.hourGapCount ?? hourGapDetails.filter((g) => g.canvasserName === stat.canvasserName).length,
    outlierGapCount:
      stat.outlierGapCount ?? outlierGapDetails.filter((g) => g.canvasserName === stat.canvasserName).length,
  }));

  return {
    id: raw.id,
    name: raw.name,
    reportDate: raw.reportDate ?? "",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sourceFiles: raw.sourceFiles ?? [],
    summary: {
      ...raw.summary,
      detectedReportDate,
      gapsOver60: raw.summary.gapsOver60 ?? hourGapDetails.length,
      outlierGapsOver120: raw.summary.outlierGapsOver120 ?? outlierGapDetails.length,
    },
    canvasserStats,
    gapDetails,
    bigGapDetails,
    hourGapDetails,
    outlierGapDetails,
    campaignResults: raw.campaignResults ?? [],
    validationIssues: raw.validationIssues ?? [],
  };
}

function toListItem(report: SavedCanvassingReport): SavedCanvassingReportListItem {
  return {
    id: report.id,
    name: report.name,
    reportDate: report.reportDate,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    summary: report.summary,
    sourceFiles: report.sourceFiles,
  };
}

export function listCanvassingReports(): SavedCanvassingReportListItem[] {
  ensureStoreDirs();
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, fileName), "utf-8")) as Partial<SavedCanvassingReport>;
        const report = hydrateReport(raw);
        return report ? toListItem(report) : null;
      } catch {
        return null;
      }
    })
    .filter((report): report is SavedCanvassingReportListItem => report !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getCanvassingReport(reportId: string): SavedCanvassingReport | null {
  ensureStoreDirs();
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return hydrateReport(JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<SavedCanvassingReport>);
  } catch {
    return null;
  }
}

export function saveCanvassingReport(input: {
  name: string;
  reportDate?: string;
  result: CanvassingReportResult;
}): SavedCanvassingReport {
  ensureStoreDirs();
  const now = new Date().toISOString();
  const report: SavedCanvassingReport = {
    id: crypto.randomUUID(),
    name: input.name.trim() || `Canvassing report ${new Date().toLocaleDateString()}`,
    reportDate: input.reportDate?.trim() || input.result.summary.detectedReportDate || "",
    createdAt: now,
    updatedAt: now,
    ...input.result,
  };

  fs.writeFileSync(reportPath(report.id), JSON.stringify(report, null, 2), "utf-8");
  return report;
}

export function deleteCanvassingReport(reportId: string): boolean {
  ensureStoreDirs();
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
