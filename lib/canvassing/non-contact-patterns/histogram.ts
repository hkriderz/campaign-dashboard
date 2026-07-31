import {
  GAP_HISTOGRAM_BUCKETS,
  type GapHistogramBucket,
} from "./types";

export function emptyGapHistogram(): Record<GapHistogramBucket, number> {
  return Object.fromEntries(GAP_HISTOGRAM_BUCKETS.map((b) => [b, 0])) as Record<GapHistogramBucket, number>;
}

export function gapToHistogramBucket(gapSeconds: number): GapHistogramBucket {
  if (gapSeconds <= 5) return "0-5";
  if (gapSeconds <= 15) return "5-15";
  if (gapSeconds <= 30) return "15-30";
  if (gapSeconds <= 60) return "30-60";
  if (gapSeconds <= 90) return "60-90";
  if (gapSeconds <= 150) return "90-150";
  return "150+";
}

export function addToHistogram(
  histogram: Record<GapHistogramBucket, number>,
  gapSeconds: number
): void {
  const bucket = gapToHistogramBucket(gapSeconds);
  histogram[bucket] += 1;
}

export function histogramTotal(histogram: Record<GapHistogramBucket, number>): number {
  return GAP_HISTOGRAM_BUCKETS.reduce((sum, b) => sum + (histogram[b] ?? 0), 0);
}

export function histogramToPct(
  histogram: Record<GapHistogramBucket, number>
): Record<GapHistogramBucket, number> {
  const total = histogramTotal(histogram);
  const out = emptyGapHistogram();
  if (total <= 0) return out;
  for (const bucket of GAP_HISTOGRAM_BUCKETS) {
    out[bucket] = histogram[bucket] / total;
  }
  return out;
}

/** Rapid 0–15s share = (0-5 + 5-15) / total gaps. */
export function rapidBucketShare0to15(histogram: Record<GapHistogramBucket, number>): number | null {
  const total = histogramTotal(histogram);
  if (total <= 0) return null;
  return ((histogram["0-5"] ?? 0) + (histogram["5-15"] ?? 0)) / total;
}
