import type { PhoneBankSummary } from "@/lib/types";

export function toDateString(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") return val.slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "object" && val !== null && "value" in val) {
    return String((val as { value: string }).value).slice(0, 10);
  }
  return null;
}

export function toNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

export function toStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

/** Map a BigQuery campaign_calls row to {@link PhoneBankSummary}. */
export function rowToPhoneBankSummary(r: Record<string, unknown>): PhoneBankSummary {
  return {
    campaignId: toStr(r.campaign_id),
    campaignName: toStr(r.campaign_name),
    totalDials: toNum(r.total_dials),
    uniqueCallers: toNum(r.unique_callers),
    totalHours: Math.round((toNum(r.total_seconds) / 3600) * 100) / 100,
    totalSeconds: toNum(r.total_seconds),
    firstCallDate: toDateString(r.first_call_date),
    lastCallDate: toDateString(r.last_call_date),
    campaignCreatedDate: toDateString(r.campaign_created_date) ?? "",
  };
}
