import { unstable_cache } from "next/cache";
import { mergedBqCacheSeconds } from "./phonebanking-data-cache";

/**
 * Optional short-lived cache for identical BigQuery reads (dynamic routes stay fresh enough for ops).
 * Set `CAMPAIGN_DASHBOARD_BQ_CACHE_SECONDS` in `.env.local` (e.g. `45`) to enable; unset or `0` = no cache.
 */
function bqCacheRevalidateSeconds(): number {
  const raw = process.env.CAMPAIGN_DASHBOARD_BQ_CACHE_SECONDS;
  if (raw == null || String(raw).trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 3600);
}

export type CachedBqOptions = {
  /** For `revalidateTag` (e.g. bust after “Refresh all”). */
  tags?: string[];
  /** Override revalidate seconds; defaults to `CAMPAIGN_DASHBOARD_BQ_CACHE_SECONDS`. */
  revalidate?: number;
};

export async function cachedBq<T>(
  keyParts: string[],
  fetcher: () => Promise<T>,
  opts?: CachedBqOptions
): Promise<T> {
  const fromEnv = bqCacheRevalidateSeconds();
  let revalidate = opts?.revalidate ?? fromEnv;
  if (revalidate <= 0 && opts?.tags?.length) {
    revalidate = mergedBqCacheSeconds();
  }
  if (revalidate <= 0) return fetcher();
  return unstable_cache(fetcher, keyParts, {
    revalidate,
    tags: opts?.tags,
  })();
}
