/**
 * Scale to Win raw `calls` totals are campaign-day grain, not per-phonebanker.
 * SQL used to park the count on one banker row; idle-row filtering then dropped it.
 * Always take MAX within a campaign-day. Never SUM across bankers.
 */

export function campaignDayRawCallKey(campaignId: string, callDate: string): string {
  return `${campaignId}::${callDate}`;
}

/** One campaign-day's raw STW call count (duplicated on every banker row after stamp). */
export function rawStwCallsForCampaignDay(rows: readonly { totalCalls?: number }[]): number {
  let max = 0;
  for (const row of rows) {
    const n = row.totalCalls ?? 0;
    if (n > max) max = n;
  }
  return max;
}

export function campaignDayRawCallTotals(
  rows: readonly { campaignId: string; callDate: string; totalCalls?: number }[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = campaignDayRawCallKey(row.campaignId, row.callDate);
    totals.set(key, Math.max(totals.get(key) ?? 0, row.totalCalls ?? 0));
  }
  return totals;
}

/** Copy the campaign-day raw count onto every banker row so idle filtering cannot drop it. */
export function stampCampaignDayRawCalls<
  T extends { campaignId: string; callDate: string; totalCalls?: number },
>(rows: readonly T[], dayTotals: ReadonlyMap<string, number>): T[] {
  return rows.map((row) => ({
    ...row,
    totalCalls: dayTotals.get(campaignDayRawCallKey(row.campaignId, row.callDate)) ?? row.totalCalls ?? 0,
  }));
}

export function stampAndKeepCampaignDayRawCalls<
  T extends { campaignId: string; callDate: string; totalCalls?: number },
>(rows: readonly T[], keep: (row: T) => boolean): T[] {
  const dayTotals = campaignDayRawCallTotals(rows);
  return stampCampaignDayRawCalls(rows, dayTotals).filter(keep);
}

/** Sum of per-campaign-day MAX totals (safe across many bankers and days). */
export function sumRawStwCallsByCampaignDay(
  rows: readonly { campaignId: string; callDate: string; totalCalls?: number }[]
): number {
  let sum = 0;
  for (const n of campaignDayRawCallTotals(rows).values()) sum += n;
  return sum;
}

/** True when the visible slices are the full dashboard (no day subset). */
export function isFullDashboardDateWindow(
  filteredSliceKeys: readonly string[],
  allSliceKeys: readonly string[]
): boolean {
  if (filteredSliceKeys.length === 0 || filteredSliceKeys.length !== allSliceKeys.length) return false;
  const all = new Set(allSliceKeys);
  return filteredSliceKeys.every((key) => all.has(key));
}

export function sumPhoneBankRawCalls(banks: readonly { totalCalls: number }[]): number {
  return banks.reduce((sum, bank) => sum + bank.totalCalls, 0);
}
