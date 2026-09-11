import type { CampaignTag, CandidateStats, PhoneBankSummary, TagDailyCallerStat } from "./types";
import { canonicalizePhonebankerKey } from "./phonebanker-name";
import { campaignGroupKey, dailyCallerSliceKey, makeSliceKey } from "./slice-key";

type Accumulator = {
  campaignId: string;
  campaignName: string;
  rawCallsByDay: Map<string, number>;
  totalDials: number;
  totalSurveyed: number;
  totalSeconds: number;
  callerKeys: Set<string>;
  firstCallDate: string | null;
  lastCallDate: string | null;
};

function isHiddenSlice(row: TagDailyCallerStat, hiddenSliceKeys: ReadonlySet<string>): boolean {
  return (
    hiddenSliceKeys.has(dailyCallerSliceKey(row)) ||
    hiddenSliceKeys.has(makeSliceKey(row.campaignName, row.callDate))
  );
}

function sumDayMaxes(byDay: Map<string, number>): number {
  let sum = 0;
  for (const n of byDay.values()) sum += n;
  return sum;
}

export function overlayCampaignRawCallTotals(
  summaries: readonly PhoneBankSummary[],
  campaignTotals: readonly PhoneBankSummary[]
): PhoneBankSummary[] {
  const byKey = new Map(
    campaignTotals.map((p) => [campaignGroupKey(p.campaignId, p.campaignName), p.totalCalls] as const)
  );
  return summaries.map((summary) => {
    const raw = byKey.get(campaignGroupKey(summary.campaignId, summary.campaignName));
    return raw == null ? summary : { ...summary, totalCalls: raw };
  });
}

export function buildPhoneBankSummariesFromDailyCallerStats(
  rows: readonly TagDailyCallerStat[],
  hiddenSliceKeys: ReadonlySet<string> = new Set(),
  campaignRawCallTotals: readonly PhoneBankSummary[] = []
): PhoneBankSummary[] {
  const byCampaign = new Map<string, Accumulator>();

  for (const row of rows) {
    if (isHiddenSlice(row, hiddenSliceKeys)) continue;

    const campaignKey = campaignGroupKey(row.campaignId, row.campaignName);
    const existing = byCampaign.get(campaignKey);
    const acc: Accumulator =
      existing ??
      {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        rawCallsByDay: new Map<string, number>(),
        totalDials: 0,
        totalSurveyed: 0,
        totalSeconds: 0,
        callerKeys: new Set<string>(),
        firstCallDate: null,
        lastCallDate: null,
      };

    acc.rawCallsByDay.set(
      row.callDate,
      Math.max(acc.rawCallsByDay.get(row.callDate) ?? 0, row.totalCalls ?? 0)
    );
    acc.totalDials += row.numDials;
    acc.totalSurveyed += row.surveyed;
    acc.totalSeconds += row.totalCallSeconds;
    acc.callerKeys.add(canonicalizePhonebankerKey(row.phonebankerName));
    if (!acc.campaignId && row.campaignId) acc.campaignId = row.campaignId;
    if (!acc.firstCallDate || row.callDate < acc.firstCallDate) acc.firstCallDate = row.callDate;
    if (!acc.lastCallDate || row.callDate > acc.lastCallDate) acc.lastCallDate = row.callDate;

    byCampaign.set(campaignKey, acc);
  }

  const summaries = Array.from(byCampaign.values())
    .map((acc) => ({
      campaignId: acc.campaignId,
      campaignName: acc.campaignName,
      totalCalls: sumDayMaxes(acc.rawCallsByDay),
      totalDials: acc.totalDials,
      totalSurveyed: acc.totalSurveyed,
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

  return overlayCampaignRawCallTotals(summaries, campaignRawCallTotals);
}

export function buildCandidateStatsFromDailyCallerStats(
  tag: CampaignTag,
  rows: readonly TagDailyCallerStat[],
  hiddenSliceKeys: ReadonlySet<string> = new Set(),
  campaignRawCallTotals: readonly PhoneBankSummary[] = []
): CandidateStats {
  const phoneBanks = buildPhoneBankSummariesFromDailyCallerStats(
    rows,
    hiddenSliceKeys,
    campaignRawCallTotals
  );
  const dates = phoneBanks.flatMap((p) => [p.firstCallDate, p.lastCallDate]).filter(Boolean) as string[];
  const sortedDates = [...dates].sort();
  const callerKeys = new Set<string>();
  for (const row of rows) {
    if (isHiddenSlice(row, hiddenSliceKeys)) continue;
    const key = canonicalizePhonebankerKey(row.phonebankerName);
    if (key) callerKeys.add(key);
  }

  const totalCalls = campaignRawCallTotals.length
    ? campaignRawCallTotals.reduce((sum, bank) => sum + bank.totalCalls, 0)
    : phoneBanks.reduce((sum, bank) => sum + bank.totalCalls, 0);

  return {
    tag,
    totalCalls,
    totalDials: phoneBanks.reduce((s, p) => s + p.totalDials, 0),
    totalSurveyed: phoneBanks.reduce((s, p) => s + p.totalSurveyed, 0),
    uniqueCallers: callerKeys.size,
    totalHours: Math.round(phoneBanks.reduce((s, p) => s + p.totalHours, 0) * 100) / 100,
    phoneBankCount: phoneBanks.length,
    firstCallDate: sortedDates[0] ?? null,
    lastCallDate: sortedDates.at(-1) ?? null,
    phoneBanks,
  };
}
