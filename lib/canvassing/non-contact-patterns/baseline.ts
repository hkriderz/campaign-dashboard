import { subtractIsoDays } from "@/lib/validation/iso-date";
import {
  emptyGapHistogram,
  findNearDuplicateNames,
  histogramToPct,
  median,
  percentile,
  rapidBucketShare0to15,
} from "./helpers";
import type { HistoricalReportDay } from "./historical";
import {
  MIN_NON_CONTACT_GAP_SAMPLE,
  MIN_UNIFORMITY_SAMPLE,
  UNIFORMITY_TIER2_SHARE,
  type BaselineComparison,
  type CanvasserAnomalyScore,
  type CanvasserMetricsSnapshot,
  type CanvasserPatternSummary,
  type GapHistogramBucket,
  type NonContactPatternResult,
  type TeamBaseline,
} from "./types";

const MIN_HISTORY_DAYS = 3;
const MIN_STRATUM_CANVASSER_DAYS = 3;
const TOP_DECILE = 0.9;
const PERSISTENCE_LOOKBACK_DAYS = 5;
const PERSISTENCE_MIN_TOP_DAYS = 3;

function normalize(value: number, p95: number | null): number {
  if (p95 === null || p95 <= 0) return 0;
  return Math.min(value / p95, 1);
}

function flattenCanvasserDays(
  history: HistoricalReportDay[],
  stratumTag?: string | null
): Array<CanvasserMetricsSnapshot & { reportDate: string }> {
  const rows: Array<CanvasserMetricsSnapshot & { reportDate: string }> = [];
  for (const day of history) {
    for (const c of day.metricsSnapshot.canvassers) {
      if (stratumTag && c.stratumTag !== stratumTag) continue;
      rows.push({ ...c, reportDate: day.reportDate });
    }
  }
  return rows;
}

function computeIqrBounds(values: number[]): TeamBaseline["iqrRapidCount"] {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  if (q1 === null || q3 === null) return null;
  const iqr = q3 - q1;
  return { q1, q3, lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
}

export function computeTeamBaseline(
  history: HistoricalReportDay[],
  options?: { stratumTag?: string | null }
): TeamBaseline {
  const reportDates = [...new Set(history.map((h) => h.reportDate))].sort();
  const stratumTag = options?.stratumTag ?? null;

  let canvasserDays = flattenCanvasserDays(history, stratumTag);
  // Fall back to pooled baseline when stratum has too few canvasser-days.
  let effectiveStratum = stratumTag;
  if (stratumTag && canvasserDays.length < MIN_STRATUM_CANVASSER_DAYS) {
    canvasserDays = flattenCanvasserDays(history, null);
    effectiveStratum = null;
  }

  const teamGapHistogram = emptyGapHistogram();
  for (const c of canvasserDays) {
    for (const [bucket, count] of Object.entries(c.gapHistogram) as Array<[GapHistogramBucket, number]>) {
      teamGapHistogram[bucket] += count;
    }
  }

  const rates = canvasserDays
    .map((c) => c.rapidNonContactRate)
    .filter((r): r is number => r !== null);
  const streaks = canvasserDays.map((c) => c.longestStreak);
  const rapidCounts = canvasserDays.map((c) => c.rapidNonContactCount);
  const knocksPerHour = canvasserDays
    .map((c) => c.knocksPerHour)
    .filter((v): v is number => v !== null);
  const nonContactRates = canvasserDays
    .map((c) => c.nonContactRate)
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r));

  const bucketShares = canvasserDays
    .map((c) => rapidBucketShare0to15(c.gapHistogram))
    .filter((v): v is number => v !== null);

  const sortedRates = [...rates].sort((a, b) => a - b);
  const sortedStreaks = [...streaks].sort((a, b) => a - b);
  const sortedBucketShares = [...bucketShares].sort((a, b) => a - b);
  const sortedKph = [...knocksPerHour].sort((a, b) => a - b);

  return {
    daysInWindow: reportDates.length,
    reportDates,
    sufficientHistory: reportDates.length >= MIN_HISTORY_DAYS,
    stratumTag: effectiveStratum,
    teamGapHistogram,
    teamGapHistogramPct: histogramToPct(teamGapHistogram),
    medianRapidRate: median(rates),
    p75RapidRate: percentile(sortedRates, 0.75),
    p90RapidRate: percentile(sortedRates, 0.9),
    p95RapidRate: percentile(sortedRates, 0.95),
    medianLongestStreak: median(streaks),
    p95LongestStreak: percentile(sortedStreaks, 0.95),
    p95RapidBucketShare0to15: percentile(sortedBucketShares, 0.95),
    iqrRapidCount: computeIqrBounds(rapidCounts),
    p90KnocksPerHour: percentile(sortedKph, 0.9),
    medianNonContactRate: median(nonContactRates),
  };
}

function personalMedianRate(
  history: HistoricalReportDay[],
  canvasserName: string
): number | null {
  const rates: number[] = [];
  for (const day of history) {
    const c = day.metricsSnapshot.canvassers.find((x) => x.canvasserName === canvasserName);
    if (c?.rapidNonContactRate !== null && c?.rapidNonContactRate !== undefined) {
      rates.push(c.rapidNonContactRate);
    }
  }
  return median(rates);
}

/**
 * Count how many of the last N saved days the canvasser was in the top decile
 * of rapidNonContactRate (among sufficient-sample canvasser-days that day).
 */
function topDecilePersistence(
  history: HistoricalReportDay[],
  canvasserName: string,
  lookbackDays = PERSISTENCE_LOOKBACK_DAYS
): { topDays: number; daysPresent: number } {
  const byDate = new Map<string, HistoricalReportDay>();
  for (const day of history) byDate.set(day.reportDate, day);
  const dates = [...byDate.keys()].sort().slice(-lookbackDays);

  let topDays = 0;
  let daysPresent = 0;

  for (const date of dates) {
    const day = byDate.get(date)!;
    const eligible = day.metricsSnapshot.canvassers.filter(
      (c) => c.rapidNonContactRate !== null && c.nonContactGapCount >= MIN_NON_CONTACT_GAP_SAMPLE
    );
    if (!eligible.length) continue;
    const me = eligible.find((c) => c.canvasserName === canvasserName);
    if (!me || me.rapidNonContactRate === null) continue;
    daysPresent++;
    const sorted = [...eligible].sort(
      (a, b) => (b.rapidNonContactRate ?? 0) - (a.rapidNonContactRate ?? 0)
    );
    const decileIndex = Math.max(0, Math.floor(sorted.length * (1 - TOP_DECILE)));
    const threshold = sorted[decileIndex]?.rapidNonContactRate ?? Infinity;
    if (me.rapidNonContactRate >= threshold) topDays++;
  }

  return { topDays, daysPresent };
}

export function scoreCanvassersAgainstBaseline(params: {
  summaries: CanvasserPatternSummary[];
  baseline: TeamBaseline;
  history: HistoricalReportDay[];
  percentileHistory?: HistoricalReportDay[];
}): CanvasserAnomalyScore[] {
  const { summaries, baseline } = params;
  const percentileHistory = params.percentileHistory ?? params.history;

  return summaries.map((s) => {
    const signals: string[] = [];
    let tier: CanvasserAnomalyScore["anomalyTier"] = null;

    const bucketShare = rapidBucketShare0to15(s.gapHistogram);
    const personalMedian = personalMedianRate(percentileHistory, s.canvasserName);

    // Tier 1 signals
    if (s.rapidNonContactCount > 0) {
      signals.push(`Rapid non-contact flags: ${s.rapidNonContactCount}`);
    }
    if (s.streakAlert) {
      signals.push(`Streak ≥ ${s.longestRapidNonContactStreak}`);
      tier = 1;
    }
    if (s.burstAlert) {
      signals.push(`Burst alert: ${s.maxBurstCount} NC marks in window`);
      tier = 1;
    }
    if (
      bucketShare !== null &&
      baseline.p95RapidBucketShare0to15 !== null &&
      bucketShare > baseline.p95RapidBucketShare0to15
    ) {
      signals.push(
        `0–15s gap share ${(bucketShare * 100).toFixed(1)}% > team P95 ${(baseline.p95RapidBucketShare0to15 * 100).toFixed(1)}%`
      );
      tier = 1;
    }
    if (s.rapidNonContactCount > 0 && tier === null) {
      // Absolute flags present but no streak/skew yet — still high-confidence primary signal when elevated
      if (
        baseline.p95RapidRate !== null &&
        s.rapidNonContactRate !== null &&
        s.rapidNonContactRate >= baseline.p95RapidRate
      ) {
        tier = 1;
      }
    }

    // Tier 2 — contextual (require persistence for rank-based)
    let tier2 = false;
    if (
      s.rapidNonContactRate !== null &&
      personalMedian !== null &&
      personalMedian > 0 &&
      s.rapidNonContactRate > 2 * personalMedian &&
      (baseline.medianRapidRate === null || s.rapidNonContactRate > baseline.medianRapidRate)
    ) {
      signals.push(
        `Rapid rate ${(s.rapidNonContactRate * 100).toFixed(1)}% > 2× personal median ${(personalMedian * 100).toFixed(1)}%`
      );
      tier2 = true;
    }

    const persistence = topDecilePersistence(percentileHistory, s.canvasserName);
    if (persistence.topDays >= PERSISTENCE_MIN_TOP_DAYS) {
      signals.push(
        `Top-decile rapid rate on ${persistence.topDays} of last ${PERSISTENCE_LOOKBACK_DAYS} days`
      );
      tier2 = true;
    } else if (persistence.topDays === 1) {
      signals.push(`Top-decile today (single day — context only, not elevating score)`);
    }

    if (
      baseline.iqrRapidCount &&
      (s.rapidNonContactCount > baseline.iqrRapidCount.upper ||
        s.rapidNonContactCount < baseline.iqrRapidCount.lower)
    ) {
      signals.push(
        `Rapid count ${s.rapidNonContactCount} outside IQR band [${baseline.iqrRapidCount.lower.toFixed(1)}, ${baseline.iqrRapidCount.upper.toFixed(1)}]`
      );
      tier2 = true;
    }

    if (
      s.knocksPerHour !== null &&
      baseline.p90KnocksPerHour !== null &&
      s.knocksPerHour > baseline.p90KnocksPerHour &&
      (baseline.medianNonContactRate === null || s.nonContactRate > baseline.medianNonContactRate)
    ) {
      signals.push(`Knocks/hour ${s.knocksPerHour.toFixed(1)} > team P90 with elevated non-contact rate`);
      tier2 = true;
    }

    if (
      s.dominantRapidResponseShare !== null &&
      s.rapidOrBurstResponseSample >= MIN_UNIFORMITY_SAMPLE &&
      s.dominantRapidResponseShare >= UNIFORMITY_TIER2_SHARE
    ) {
      signals.push(
        `Response uniformity ${(s.dominantRapidResponseShare * 100).toFixed(0)}% on ${s.rapidOrBurstResponseSample} rapid/burst rows`
      );
      tier2 = true;
    }

    if (tier === null && tier2) tier = 2;

    // Tier 3
    if (s.rapidContactCount > 0) {
      signals.push(`Rapid contact flags (lower confidence): ${s.rapidContactCount}`);
      if (tier === null) tier = 3;
    }

    // Composite score (calibrated starting weights 40/25/25/10).
    // normalize(x, p95) = min(x / p95, 1.0). Count P95 proxied by IQR upper or session max.
    const countP95Proxy =
      baseline.iqrRapidCount?.upper ??
      Math.max(...summaries.map((x) => x.rapidNonContactCount), 1);
    const rateDeltaNorm =
      personalMedian !== null && personalMedian > 0 && s.rapidNonContactRate !== null
        ? normalize(s.rapidNonContactRate / personalMedian, 2)
        : 0;

    const burstNorm = normalize(s.maxBurstCount, Math.max(s.maxBurstCount, 5));

    const compositeScore = Math.round(
      Math.min(
        100,
        35 * normalize(s.rapidNonContactCount, Math.max(countP95Proxy, 1)) +
          20 * normalize(s.longestRapidNonContactStreak, baseline.p95LongestStreak ?? 4) +
          20 * normalize(bucketShare ?? 0, baseline.p95RapidBucketShare0to15 ?? 0.5) +
          15 * burstNorm +
          10 * rateDeltaNorm
      )
    );

    return {
      canvasserName: s.canvasserName,
      anomalyTier: tier,
      compositeScore,
      signals,
      personalRapidRateMedian: personalMedian,
      teamRapidRateMedian: baseline.medianRapidRate,
      teamRapidRateP95: baseline.p95RapidRate,
      rapidBucketShare0to15: bucketShare,
      teamRapidBucketShareP95: baseline.p95RapidBucketShare0to15,
    };
  });
}

export function buildBaselineComparison(params: {
  result: NonContactPatternResult;
  history: HistoricalReportDay[];
  percentileHistory?: HistoricalReportDay[];
  asOfDate?: string;
}): BaselineComparison {
  const dominantStratum = params.result.metricsSnapshot?.stratumTag ?? null;
  const baseline = computeTeamBaseline(params.history, { stratumTag: dominantStratum });
  const nearDuplicateNameWarnings = findNearDuplicateNames(
    params.result.canvasserSummaries.map((c) => c.canvasserName)
  );

  const canvasserScores = scoreCanvassersAgainstBaseline({
    summaries: params.result.canvasserSummaries,
    baseline,
    history: params.history,
    percentileHistory: params.percentileHistory,
  });

  return { baseline, canvasserScores, nearDuplicateNameWarnings };
}

/** Helper for API: empty baseline when insufficient history. */
export function emptyBaselineBanner(): string {
  return "Need more saved reports to establish baseline — save daily exports to build history.";
}

export function defaultHistoryWindow(asOfDate?: string): { fromDate: string; toDateExclusive: string } {
  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10);
  return { fromDate: subtractIsoDays(asOf, 7), toDateExclusive: asOf };
}
