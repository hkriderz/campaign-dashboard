/**
 * Process-local Lit QC tally cache keyed by knock-index mtime/size.
 * Invalidated whenever the knock index is rewritten.
 */
import "server-only";

import {
  knockIndexCacheStamp,
  loadKnockIndexRows,
  onKnockIndexWrite,
} from "./knock-index-store";
import { buildLitQc, type LitQcTally } from "./lit-qc";

let cached: { stamp: string; tally: LitQcTally } | null = null;

function clearLitQcTallyCache(): void {
  cached = null;
}

onKnockIndexWrite(clearLitQcTallyCache);

/** Full Lit QC tally for the current knock index (built once per stamp per process). */
export function getCachedLitQcTally(): LitQcTally {
  const stamp = knockIndexCacheStamp();
  if (cached && cached.stamp === stamp) return cached.tally;
  const tally = buildLitQc(loadKnockIndexRows());
  cached = { stamp, tally };
  return tally;
}

/** Test helper. */
export function clearLitQcTallyCacheForTests(): void {
  clearLitQcTallyCache();
}
