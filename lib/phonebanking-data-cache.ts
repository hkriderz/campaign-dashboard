import { revalidateTag } from "next/cache";

/** Next.js cache tag: phone bank list query for a tag (`fetchPhoneBanksByTag`). */
export function phonebankingPhoneBanksTag(tagId: string): string {
  return `phonebanking-phonebanks-${tagId}`;
}

/**
 * Fallback TTL for `cachedBq` when `tags` are set but `CAMPAIGN_DASHBOARD_BQ_CACHE_SECONDS` is 0.
 * Large merged datasets (daily caller, question stats) are not cached in Next.js — they exceed the ~2MB limit.
 */
export function mergedBqCacheSeconds(): number {
  const raw = process.env.CAMPAIGN_DASHBOARD_MERGED_BQ_CACHE_SECONDS;
  if (raw != null && String(raw).trim() === "0") return 0;
  if (raw == null || String(raw).trim() === "") return 120;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 120;
  return Math.min(Math.floor(n), 3600);
}

/** Bust Next.js cache for this tag after a snapshot rebuild (phone bank list only). */
export function revalidatePhonebankingTagDataCaches(tagId: string): void {
  revalidateTag(phonebankingPhoneBanksTag(tagId));
}
