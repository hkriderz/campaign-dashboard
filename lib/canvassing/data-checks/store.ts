import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { DataChecksReport, SavedDataChecksListItem, SavedDataChecksReport } from "./types";

const DATA_ROOT = path.join(process.cwd(), "data", "canvassing-data-checks");
const REPORTS_DIR = path.join(DATA_ROOT, "reports");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeReportId(reportId: string): string {
  return reportId.replace(/[^a-z0-9_-]/gi, "");
}

function reportPath(reportId: string): string {
  return path.join(REPORTS_DIR, `${safeReportId(reportId)}.json`);
}

function hydrateReport(raw: Partial<SavedDataChecksReport>): SavedDataChecksReport | null {
  if (!raw.id || !raw.name || !raw.createdAt || !raw.updatedAt || !raw.summary) return null;
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sourceFiles: raw.sourceFiles ?? [],
    campaigns: raw.campaigns ?? [],
    settings: raw.settings!,
    summary: {
      ...raw.summary,
      flags: {
        low_doors_low_support: raw.summary.flags?.low_doors_low_support ?? [],
        low_contact_rate: raw.summary.flags?.low_contact_rate ?? [],
        survey_support_struggle: raw.summary.flags?.survey_support_struggle ?? [],
        non_contact_outlier: raw.summary.flags?.non_contact_outlier ?? [],
        geo_timing_check: raw.summary.flags?.geo_timing_check ?? [],
      },
    },
    validationIssues: raw.validationIssues ?? [],
  };
}

function toListItem(report: SavedDataChecksReport): SavedDataChecksListItem {
  return {
    id: report.id,
    name: report.name,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    summary: report.summary,
    sourceFiles: report.sourceFiles,
  };
}

export function listDataChecksReports(): SavedDataChecksListItem[] {
  ensureDir(REPORTS_DIR);
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, fileName), "utf-8")) as Partial<SavedDataChecksReport>;
        const report = hydrateReport(raw);
        return report ? toListItem(report) : null;
      } catch {
        return null;
      }
    })
    .filter((report): report is SavedDataChecksListItem => report !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDataChecksReport(reportId: string): SavedDataChecksReport | null {
  ensureDir(REPORTS_DIR);
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return hydrateReport(JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<SavedDataChecksReport>);
  } catch {
    return null;
  }
}

export function saveDataChecksReport(input: { name: string; result: DataChecksReport }): SavedDataChecksReport {
  ensureDir(REPORTS_DIR);
  const now = new Date().toISOString();
  const report: SavedDataChecksReport = {
    id: crypto.randomUUID(),
    name: input.name.trim() || `Data checks ${input.result.summary.reportDate ?? new Date().toLocaleDateString()}`,
    createdAt: now,
    updatedAt: now,
    ...input.result,
  };
  fs.writeFileSync(reportPath(report.id), JSON.stringify(report, null, 2), "utf-8");
  return report;
}

export function deleteDataChecksReport(reportId: string): boolean {
  ensureDir(REPORTS_DIR);
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
