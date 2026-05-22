import type { CampaignTag, CandidateStats, PhoneBankSummary, TagDailyCallerStat } from "./types";
import { canonicalizePhonebankerKey } from "./phonebanker-name";
import { makeSliceKey, normalizeCampaignKey } from "./slice-key";

type Accumulator = {
  campaignId: string;
  campaignName: string;
  totalDials: number;
  totalSeconds: number;
  callerKeys: Set<string>;
  firstCallDate: string | null;
  lastCallDate: string | null;
};

export function buildPhoneBankSummariesFromDailyCallerStats(
  rows: readonly TagDailyCallerStat[],
  hiddenSliceKeys: ReadonlySet<string> = new Set()
): PhoneBankSummary[] {
  const byCampaign = new Map<string, Accumulator>();

  for (const row of rows) {
    if (hiddenSliceKeys.has(makeSliceKey(row.campaignName, row.callDate))) continue;

    const campaignKey = normalizeCampaignKey(row.campaignName);
    const existing = byCampaign.get(campaignKey);
    const acc: Accumulator =
      existing ??
      {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        totalDials: 0,
        totalSeconds: 0,
        callerKeys: new Set<string>(),
        firstCallDate: null,
        lastCallDate: null,
      };

    acc.totalDials += row.numDials;
    acc.totalSeconds += row.totalCallSeconds;
    acc.callerKeys.add(canonicalizePhonebankerKey(row.phonebankerName));
    if (!acc.campaignId && row.campaignId) acc.campaignId = row.campaignId;
    if (!acc.firstCallDate || row.callDate < acc.firstCallDate) acc.firstCallDate = row.callDate;
    if (!acc.lastCallDate || row.callDate > acc.lastCallDate) acc.lastCallDate = row.callDate;

    byCampaign.set(campaignKey, acc);
  }

  return Array.from(byCampaign.values())
    .map((acc) => ({
      campaignId: acc.campaignId,
      campaignName: acc.campaignName,
      totalDials: acc.totalDials,
      uniqueCallers: acc.callerKeys.size,
      totalHours: Math.round((acc.totalSeconds / 3600) * 100) / 100,
      totalSeconds: acc.totalSeconds,
      firstCallDate: acc.firstCallDate,
      lastCallDate: acc.lastCallDate,
      campaignCreatedDate: "",
    }))
    .sort((a, b) => {
      const dateCompare = (b.lastCallDate ?? "").localeCompare(a.lastCallDate ?? "");
      if (dateCompare !== 0) return dateCompare;
      return b.totalDials - a.totalDials || a.campaignName.localeCompare(b.campaignName);
    });
}

export function buildCandidateStatsFromDailyCallerStats(
  tag: CampaignTag,
  rows: readonly TagDailyCallerStat[],
  hiddenSliceKeys: ReadonlySet<string> = new Set()
): CandidateStats {
  const phoneBanks = buildPhoneBankSummariesFromDailyCallerStats(rows, hiddenSliceKeys);
  const dates = phoneBanks.flatMap((p) => [p.firstCallDate, p.lastCallDate]).filter(Boolean) as string[];
  const sortedDates = [...dates].sort();

  return {
    tag,
    totalDials: phoneBanks.reduce((s, p) => s + p.totalDials, 0),
    uniqueCallers: phoneBanks.reduce((s, p) => s + p.uniqueCallers, 0),
    totalHours: Math.round(phoneBanks.reduce((s, p) => s + p.totalHours, 0) * 100) / 100,
    phoneBankCount: phoneBanks.length,
    firstCallDate: sortedDates[0] ?? null,
    lastCallDate: sortedDates.at(-1) ?? null,
    phoneBanks,
  };
}
