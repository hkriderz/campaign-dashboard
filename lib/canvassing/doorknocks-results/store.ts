import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  DoorknockResultsReport,
  SavedDoorknockResultsListItem,
  SavedDoorknockResultsReport,
} from "./types";

const DATA_ROOT = path.join(process.cwd(), "data", "canvassing-doorknocks-results");
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

function hydrateReport(raw: Partial<SavedDoorknockResultsReport>): SavedDoorknockResultsReport | null {
  if (!raw.id || !raw.name || !raw.createdAt || !raw.updatedAt || !raw.summary) return null;
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sourceFiles: raw.sourceFiles ?? [],
    campaigns: raw.campaigns ?? [],
    settings: raw.settings!,
    summary: raw.summary,
    validationIssues: raw.validationIssues ?? [],
  };
}

function toListItem(report: SavedDoorknockResultsReport): SavedDoorknockResultsListItem {
  return {
    id: report.id,
    name: report.name,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    summary: report.summary,
    sourceFiles: report.sourceFiles,
  };
}

export function listDoorknockReports(): SavedDoorknockResultsListItem[] {
  ensureStoreDirs();
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, fileName), "utf-8")) as Partial<SavedDoorknockResultsReport>;
        const report = hydrateReport(raw);
        return report ? toListItem(report) : null;
      } catch {
        return null;
      }
    })
    .filter((report): report is SavedDoorknockResultsListItem => report !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDoorknockReport(reportId: string): SavedDoorknockResultsReport | null {
  ensureStoreDirs();
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return hydrateReport(JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<SavedDoorknockResultsReport>);
  } catch {
    return null;
  }
}

export function saveDoorknockReport(input: {
  name: string;
  result: DoorknockResultsReport;
}): SavedDoorknockResultsReport {
  ensureStoreDirs();
  const now = new Date().toISOString();
  const report: SavedDoorknockResultsReport = {
    id: crypto.randomUUID(),
    name: input.name.trim() || `Doorknocks results ${input.result.summary.reportDate ?? new Date().toLocaleDateString()}`,
    createdAt: now,
    updatedAt: now,
    ...input.result,
  };
  fs.writeFileSync(reportPath(report.id), JSON.stringify(report, null, 2), "utf-8");
  return report;
}

export function deleteDoorknockReport(reportId: string): boolean {
  ensureStoreDirs();
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
