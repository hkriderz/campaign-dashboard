import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  NonContactPatternResult,
  SavedNonContactPatternListItem,
  SavedNonContactPatternReport,
} from "./types";

/**
 * DATA GOVERNANCE / PII RETENTION
 * -------------------------------
 * Saved reports under data/canvassing-non-contact-patterns/ contain voter names,
 * phone numbers, and canvasser performance / fraud-adjacent scores.
 *
 * Retention policy (v1):
 * - Full row-level detail (enrichedRows / flagged rows with voter PII) should be
 *   kept only as long as needed for spot-checking — default 90 days.
 * - After the retention window, prunePiiFromOldReports() strips voter-level
 *   fields and retains only aggregated metricsSnapshot for baseline history.
 *
 * Access control note:
 * - Anyone with access to /canvassing can view per-canvasser anomaly scores.
 * - Scores are a review-prioritization aid, not a finding of fact; human
 *   verification is required before any personnel action.
 * - If access should be narrower than the rest of canvassing tools, scope this
 *   route behind the same access boundary as other sensitive canvassing data.
 */
export const PII_RETENTION_DAYS = 90;

const DATA_ROOT = path.join(process.cwd(), "data", "canvassing-non-contact-patterns");
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

function hydrateReport(raw: Partial<SavedNonContactPatternReport>): SavedNonContactPatternReport | null {
  if (!raw.id || !raw.name || !raw.createdAt || !raw.updatedAt || !raw.summary) return null;
  return {
    id: raw.id,
    name: raw.name,
    reportDate: raw.reportDate ?? raw.summary.detectedReportDate ?? "",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    sourceChecksum: raw.sourceChecksum ?? "",
    sourceFiles: raw.sourceFiles ?? [],
    summary: raw.summary,
    canvasserSummaries: raw.canvasserSummaries ?? [],
    enrichedRows: raw.enrichedRows ?? [],
    flaggedNonContactRows: raw.flaggedNonContactRows ?? [],
    flaggedContactRows: raw.flaggedContactRows ?? [],
    metricsSnapshot: raw.metricsSnapshot ?? null,
    validationIssues: raw.validationIssues ?? [],
  };
}

function toListItem(report: SavedNonContactPatternReport): SavedNonContactPatternListItem {
  return {
    id: report.id,
    name: report.name,
    reportDate: report.reportDate,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    sourceChecksum: report.sourceChecksum,
    summary: report.summary,
    sourceFiles: report.sourceFiles,
    hasMetricsSnapshot: Boolean(report.metricsSnapshot),
  };
}

export function listNonContactPatternReports(): SavedNonContactPatternListItem[] {
  ensureStoreDirs();
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(REPORTS_DIR, fileName), "utf-8")
        ) as Partial<SavedNonContactPatternReport>;
        const report = hydrateReport(raw);
        return report ? toListItem(report) : null;
      } catch {
        return null;
      }
    })
    .filter((report): report is SavedNonContactPatternListItem => report !== null)
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt));
}

export function getNonContactPatternReport(reportId: string): SavedNonContactPatternReport | null {
  ensureStoreDirs();
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return hydrateReport(
      JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<SavedNonContactPatternReport>
    );
  } catch {
    return null;
  }
}

function findExistingByDateAndChecksum(
  reportDate: string,
  sourceChecksum: string
): SavedNonContactPatternReport | null {
  if (!reportDate || !sourceChecksum) return null;
  for (const item of listNonContactPatternReports()) {
    if (item.reportDate === reportDate && item.sourceChecksum === sourceChecksum) {
      return getNonContactPatternReport(item.id);
    }
  }
  return null;
}

/**
 * Save a report. Keyed by reportDate + sourceChecksum so re-uploading the same
 * day's file overwrites instead of duplicating.
 */
export function saveNonContactPatternReport(input: {
  name: string;
  reportDate?: string;
  result: NonContactPatternResult;
  sourceChecksum?: string;
}): SavedNonContactPatternReport {
  ensureStoreDirs();
  const now = new Date().toISOString();
  const reportDate =
    input.reportDate?.trim() ||
    input.result.summary.detectedReportDate ||
    input.result.metricsSnapshot?.reportDate ||
    "";
  const sourceChecksum =
    input.sourceChecksum ||
    input.result.metricsSnapshot?.sourceChecksum ||
    input.result.sourceFiles.map((f) => f.checksum).sort().join("|") ||
    crypto.randomUUID();

  const existing = findExistingByDateAndChecksum(reportDate, sourceChecksum);
  const report: SavedNonContactPatternReport = {
    id: existing?.id ?? crypto.randomUUID(),
    name:
      input.name.trim() ||
      `Non-contact patterns ${reportDate || new Date().toLocaleDateString()}`,
    reportDate,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    sourceChecksum,
    ...input.result,
    // Ensure metrics snapshot checksum matches store key.
    metricsSnapshot: input.result.metricsSnapshot
      ? { ...input.result.metricsSnapshot, sourceChecksum, reportDate: reportDate || input.result.metricsSnapshot.reportDate }
      : null,
  };

  fs.writeFileSync(reportPath(report.id), JSON.stringify(report, null, 2), "utf-8");
  return report;
}

/** Save multiple per-date results from a date-aware (gap-fill) upload. */
export function saveNonContactPatternReports(input: {
  namePrefix: string;
  results: NonContactPatternResult[];
}): SavedNonContactPatternReport[] {
  return input.results.map((result) => {
    const date = result.summary.detectedReportDate ?? "unknown";
    return saveNonContactPatternReport({
      name: `${input.namePrefix.trim() || "Non-contact patterns"} (${date})`,
      reportDate: date,
      result,
    });
  });
}

export function deleteNonContactPatternReport(reportId: string): boolean {
  ensureStoreDirs();
  const filePath = reportPath(reportId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function daysBetweenIso(isoDate: string, todayIso: string): number {
  const a = new Date(`${isoDate}T12:00:00Z`).getTime();
  const b = new Date(`${todayIso}T12:00:00Z`).getTime();
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Strip voter-level PII from reports older than PII_RETENTION_DAYS while
 * retaining metricsSnapshot for baseline history.
 */
export function prunePiiFromOldReports(todayIso?: string): { pruned: number; skipped: number } {
  ensureStoreDirs();
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  let pruned = 0;
  let skipped = 0;

  for (const item of listNonContactPatternReports()) {
    if (!item.reportDate) {
      skipped++;
      continue;
    }
    const age = daysBetweenIso(item.reportDate, today);
    if (age < PII_RETENTION_DAYS) {
      skipped++;
      continue;
    }

    const report = getNonContactPatternReport(item.id);
    if (!report) {
      skipped++;
      continue;
    }

    // Already pruned?
    if (
      report.enrichedRows.length === 0 &&
      report.flaggedNonContactRows.length === 0 &&
      report.flaggedContactRows.length === 0
    ) {
      skipped++;
      continue;
    }

    const prunedReport: SavedNonContactPatternReport = {
      ...report,
      enrichedRows: [],
      flaggedNonContactRows: [],
      flaggedContactRows: [],
      updatedAt: new Date().toISOString(),
      validationIssues: [
        ...report.validationIssues,
        {
          severity: "info",
          code: "pii_pruned",
          message: `Voter-level detail pruned after ${PII_RETENTION_DAYS}-day retention window; metricsSnapshot retained for baselines.`,
        },
      ],
    };
    fs.writeFileSync(reportPath(report.id), JSON.stringify(prunedReport, null, 2), "utf-8");
    pruned++;
  }

  return { pruned, skipped };
}
