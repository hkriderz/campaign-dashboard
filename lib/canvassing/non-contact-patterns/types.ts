import type { CanvassingKnockEvent, CanvassingSourceFile, CanvassingValidationIssue } from "../types";

export const METRICS_SCHEMA_VERSION = 1 as const;
export const MIN_NON_CONTACT_GAP_SAMPLE = 10;
export const SECOND_RESOLUTION_MIN_SHARE = 0.8;

export type TimestampResolution = "second" | "minute";

export type GapHistogramBucket = "0-5" | "5-15" | "15-30" | "30-60" | "60-90" | "90-150" | "150+";

export const GAP_HISTOGRAM_BUCKETS: GapHistogramBucket[] = [
  "0-5",
  "5-15",
  "15-30",
  "30-60",
  "60-90",
  "90-150",
  "150+",
];

export type NonContactPatternSettings = {
  rapidNonContactMaxSeconds: number;
  rapidContactMaxSeconds: number;
  streakAlertMin: number;
};

export const DEFAULT_NON_CONTACT_PATTERN_SETTINGS: NonContactPatternSettings = {
  rapidNonContactMaxSeconds: 15,
  rapidContactMaxSeconds: 30,
  streakAlertMin: 4,
};

export type EnrichedKnockRow = CanvassingKnockEvent & {
  lastName: string;
  gapToNextSeconds: number | null;
  sameHouseholdAsNext: boolean;
  rapidNonContactFlag: boolean;
  streakLength: number;
  rapidContactFlag: boolean;
  isoDate: string | null;
};

export type CanvasserPatternSummary = {
  canvasserName: string;
  totalRows: number;
  nonContactRowCount: number;
  nonContactRate: number;
  nonContactGapCount: number;
  rapidNonContactCount: number;
  /** null when nonContactGapCount < MIN_NON_CONTACT_GAP_SAMPLE */
  rapidNonContactRate: number | null;
  rateSampleInsufficient: boolean;
  longestRapidNonContactStreak: number;
  rapidContactCount: number;
  streakAlert: boolean;
  firstKnockAt: string | null;
  lastKnockAt: string | null;
  knocksPerHour: number | null;
  gapHistogram: Record<GapHistogramBucket, number>;
  stratumTag: string;
};

export type NonContactPatternSummary = {
  detectedReportDate: string | null;
  distinctDates: string[];
  timestampResolution: TimestampResolution;
  resolutionWarning: string | null;
  totalRows: number;
  totalCanvassers: number;
  rapidNonContactFlagCount: number;
  rapidContactFlagCount: number;
  streakAlertCanvasserCount: number;
  settings: NonContactPatternSettings;
};

export type CanvasserMetricsSnapshot = {
  canvasserName: string;
  nonContactRowCount: number;
  nonContactGapCount: number;
  rapidNonContactCount: number;
  rapidNonContactRate: number | null;
  longestStreak: number;
  rapidContactCount: number;
  gapHistogram: Record<GapHistogramBucket, number>;
  knocksPerHour: number | null;
  stratumTag: string;
};

export type ReportMetricsSnapshot = {
  schemaVersion: typeof METRICS_SCHEMA_VERSION;
  reportDate: string;
  analyzedAt: string;
  timestampResolution: TimestampResolution;
  /** Dominant stratum for the report day (mode across canvassers). */
  stratumTag: string;
  sourceChecksum: string;
  teamGapHistogram: Record<GapHistogramBucket, number>;
  canvassers: CanvasserMetricsSnapshot[];
};

export type AnomalyTier = 1 | 2 | 3 | null;

export type CanvasserAnomalyScore = {
  canvasserName: string;
  anomalyTier: AnomalyTier;
  compositeScore: number;
  signals: string[];
  personalRapidRateMedian: number | null;
  teamRapidRateMedian: number | null;
  teamRapidRateP95: number | null;
  rapidBucketShare0to15: number | null;
  teamRapidBucketShareP95: number | null;
};

export type NonContactPatternResult = {
  sourceFiles: CanvassingSourceFile[];
  summary: NonContactPatternSummary;
  canvasserSummaries: CanvasserPatternSummary[];
  enrichedRows: EnrichedKnockRow[];
  flaggedNonContactRows: EnrichedKnockRow[];
  flaggedContactRows: EnrichedKnockRow[];
  metricsSnapshot: ReportMetricsSnapshot | null;
  validationIssues: CanvassingValidationIssue[];
};

/** Preview/save response when a multi-day file is split. */
export type NonContactPatternIngestionResult = {
  results: NonContactPatternResult[];
  splitByDate: boolean;
  distinctDates: string[];
};

export type SavedNonContactPatternReport = NonContactPatternResult & {
  id: string;
  name: string;
  reportDate: string;
  createdAt: string;
  updatedAt: string;
  sourceChecksum: string;
};

export type SavedNonContactPatternListItem = {
  id: string;
  name: string;
  reportDate: string;
  createdAt: string;
  updatedAt: string;
  sourceChecksum: string;
  summary: NonContactPatternSummary;
  sourceFiles: CanvassingSourceFile[];
  hasMetricsSnapshot: boolean;
};

export type TeamBaseline = {
  daysInWindow: number;
  reportDates: string[];
  sufficientHistory: boolean;
  stratumTag: string | null;
  teamGapHistogram: Record<GapHistogramBucket, number>;
  teamGapHistogramPct: Record<GapHistogramBucket, number>;
  medianRapidRate: number | null;
  p75RapidRate: number | null;
  p90RapidRate: number | null;
  p95RapidRate: number | null;
  medianLongestStreak: number | null;
  p95LongestStreak: number | null;
  p95RapidBucketShare0to15: number | null;
  iqrRapidCount: { q1: number; q3: number; lower: number; upper: number } | null;
  p90KnocksPerHour: number | null;
  medianNonContactRate: number | null;
};

export type BaselineComparison = {
  baseline: TeamBaseline;
  canvasserScores: CanvasserAnomalyScore[];
  nearDuplicateNameWarnings: string[];
};
