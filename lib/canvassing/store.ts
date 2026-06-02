import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
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

function hydrateReport(raw: Partial<SavedCanvassingReport>): SavedCanvassingReport | null {
  if (!raw.id || !raw.name || !raw.createdAt || !raw.updatedAt || !raw.summary) return null;
  const detectedReportDate = raw.summary.detectedReportDate ?? raw.reportDate ?? null;
  return {
    id: raw.id,
    name: raw.name,
    reportDate: raw.reportDate ?? "",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sourceFiles: raw.sourceFiles ?? [],
    summary: { ...raw.summary, detectedReportDate },
    canvasserStats: raw.canvasserStats ?? [],
    gapDetails: raw.gapDetails ?? [],
    bigGapDetails: raw.bigGapDetails ?? [],
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
