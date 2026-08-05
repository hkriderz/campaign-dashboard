import "server-only";

import { subtractIsoDays } from "@/lib/validation/iso-date";
import { getNonContactPatternReport, listNonContactPatternReports } from "./store";
import {
  METRICS_SCHEMA_VERSION,
  type CanvasserMetricsSnapshot,
  type ReportMetricsSnapshot,
  type SavedNonContactPatternReport,
} from "./types";

export type HistoricalReportDay = {
  reportId: string;
  reportDate: string;
  name: string;
  metricsSnapshot: ReportMetricsSnapshot;
  rapidNonContactFlagCount: number;
  flaggedCanvasserCount: number;
};

const SUPPORTED_SCHEMA_VERSIONS = new Set([1, METRICS_SCHEMA_VERSION]);

type LegacyMetricsSnapshot = {
  schemaVersion: number;
  reportDate: string;
  analyzedAt: string;
  timestampResolution: ReportMetricsSnapshot["timestampResolution"];
  stratumTag: string;
  sourceChecksum: string;
  teamGapHistogram: ReportMetricsSnapshot["teamGapHistogram"];
  canvassers: Array<
    Partial<CanvasserMetricsSnapshot> &
      Pick<
        CanvasserMetricsSnapshot,
        | "canvasserName"
        | "nonContactRowCount"
        | "nonContactGapCount"
        | "rapidNonContactCount"
        | "rapidNonContactRate"
        | "longestStreak"
        | "rapidContactCount"
        | "gapHistogram"
        | "knocksPerHour"
        | "stratumTag"
      >
  >;
};

/**
 * Normalize older snapshots (v1) so baseline code can read v2 fields.
 * Missing v2 fields get safe defaults (0 / derived rates).
 */
export function normalizeMetricsSnapshot(raw: LegacyMetricsSnapshot | ReportMetricsSnapshot): ReportMetricsSnapshot {
  const canvassers: CanvasserMetricsSnapshot[] = raw.canvassers.map((c) => {
    const totalRows = typeof c.totalRows === "number" ? c.totalRows : 0;
    const nonContactRate =
      typeof c.nonContactRate === "number"
        ? c.nonContactRate
        : totalRows > 0
          ? c.nonContactRowCount / totalRows
          : 0;
    return {
      canvasserName: c.canvasserName,
      totalRows,
      nonContactRowCount: c.nonContactRowCount,
      nonContactRate,
      nonContactGapCount: c.nonContactGapCount,
      rapidNonContactCount: c.rapidNonContactCount,
      rapidNonContactRate: c.rapidNonContactRate,
      longestStreak: c.longestStreak,
      rapidContactCount: c.rapidContactCount,
      maxBurstCount: typeof c.maxBurstCount === "number" ? c.maxBurstCount : 0,
      gapHistogram: c.gapHistogram,
      knocksPerHour: c.knocksPerHour,
      stratumTag: c.stratumTag,
    };
  });

  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    reportDate: raw.reportDate,
    analyzedAt: raw.analyzedAt,
    timestampResolution: raw.timestampResolution,
    stratumTag: raw.stratumTag,
    sourceChecksum: raw.sourceChecksum,
    teamGapHistogram: raw.teamGapHistogram,
    canvassers,
  };
}

/**
 * Load saved report metrics for a date window.
 * Accepts current schema and v1 snapshots (normalized to v2 field shape).
 */
export function loadHistoricalMetrics(params: {
  /** Inclusive start YYYY-MM-DD */
  fromDate: string;
  /** Exclusive end YYYY-MM-DD (typically "today") */
  toDateExclusive: string;
  schemaVersion?: number;
}): HistoricalReportDay[] {
  const schemaVersion = params.schemaVersion;
  const items = listNonContactPatternReports();
  const out: HistoricalReportDay[] = [];

  for (const item of items) {
    if (!item.reportDate) continue;
    if (item.reportDate < params.fromDate || item.reportDate >= params.toDateExclusive) continue;

    const report = getNonContactPatternReport(item.id);
    if (!report?.metricsSnapshot) continue;
    const snapVersion = report.metricsSnapshot.schemaVersion as number;
    if (schemaVersion !== undefined) {
      if (snapVersion !== schemaVersion) continue;
    } else if (!SUPPORTED_SCHEMA_VERSIONS.has(snapVersion)) {
      continue;
    }

    out.push({
      reportId: report.id,
      reportDate: report.reportDate,
      name: report.name,
      metricsSnapshot: normalizeMetricsSnapshot(report.metricsSnapshot as LegacyMetricsSnapshot),
      rapidNonContactFlagCount: report.summary.rapidNonContactFlagCount,
      flaggedCanvasserCount: report.canvasserSummaries.filter((c) => c.rapidNonContactCount > 0).length,
    });
  }

  return out.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

/** Latest saved report date (YYYY-MM-DD), or null when the store is empty. */
export function latestSavedReportDate(): string | null {
  const dates = listNonContactPatternReports()
    .map((item) => item.reportDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates.length ? dates[dates.length - 1]! : null;
}

/**
 * Trailing N calendar days ending before `asOfDate`.
 * When asOf is omitted, prefer the latest saved report date so history is not
 * queried against an empty window after seed dates lag behind "today".
 */
export function loadTrailingWindowMetrics(params?: {
  days?: number;
  asOfDate?: string;
}): HistoricalReportDay[] {
  const days = params?.days ?? 7;
  const asOf =
    params?.asOfDate || latestSavedReportDate() || new Date().toISOString().slice(0, 10);
  const fromDate = subtractIsoDays(asOf, days);
  return loadHistoricalMetrics({ fromDate, toDateExclusive: asOf });
}

/** Longer window for percentile stability (default 14 days). */
export function loadPercentileWindowMetrics(params?: {
  days?: number;
  asOfDate?: string;
}): HistoricalReportDay[] {
  return loadTrailingWindowMetrics({ days: params?.days ?? 14, asOfDate: params?.asOfDate });
}

export function listHistorySummaries(params: {
  fromDate: string;
  toDate: string;
}): Array<{
  reportId: string;
  reportDate: string;
  name: string;
  rapidNonContactFlagCount: number;
  flaggedCanvasserCount: number;
  totalCanvassers: number;
}> {
  // Inclusive toDate — bump exclusive by using next day mentally via string compare on <=
  const items = listNonContactPatternReports();
  return items
    .filter((item) => item.reportDate >= params.fromDate && item.reportDate <= params.toDate)
    .map((item) => {
      const report = getNonContactPatternReport(item.id);
      return {
        reportId: item.id,
        reportDate: item.reportDate,
        name: item.name,
        rapidNonContactFlagCount: item.summary.rapidNonContactFlagCount,
        flaggedCanvasserCount:
          report?.canvasserSummaries.filter((c) => c.rapidNonContactCount > 0).length ?? 0,
        totalCanvassers: item.summary.totalCanvassers,
      };
    })
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

export function getReportForDate(reportDate: string): SavedNonContactPatternReport | null {
  const item = listNonContactPatternReports().find((r) => r.reportDate === reportDate);
  if (!item) return null;
  return getNonContactPatternReport(item.id);
}
