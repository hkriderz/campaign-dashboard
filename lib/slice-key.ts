export function normalizeCampaignKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeDateToIso(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  const mdY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!mdY) return null;

  const month = Number(mdY[1]);
  const day = Number(mdY[2]);
  let year = Number(mdY[3]);
  if (year < 100) year += 2000;

  if (
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function makeSliceKey(campaignName: string, isoDate: string): string {
  return `${normalizeCampaignKey(campaignName)}|${isoDate}`;
}

/**
 * BQ-backed slice identity. Two campaigns can share a display name (e.g. after a STW rename);
 * key by campaign id when present so Daily Aggregate / By Phone Bank stay separate.
 */
export function makeBqSliceKey(campaignId: string, campaignName: string, isoDate: string): string {
  const id = campaignId.trim();
  if (id) return `id:${id}|${isoDate}`;
  return makeSliceKey(campaignName, isoDate);
}

export function dailyCallerSliceKey(row: {
  campaignId?: string;
  campaignName: string;
  callDate: string;
}): string {
  return makeBqSliceKey(row.campaignId ?? "", row.campaignName, row.callDate);
}

/** Overview / phone-bank table grouping: id when we have it, else normalized name (CSV-only). */
export function campaignGroupKey(campaignId: string | undefined, campaignName: string): string {
  const id = campaignId?.trim() ?? "";
  if (id) return `id:${id}`;
  return `name:${normalizeCampaignKey(campaignName)}`;
}

/**
 * CSV attaches to a BQ slice only when exactly one campaign id uses that name on that date.
 * Two same-named BQ banks stay on their id keys; the CSV row keeps a name-only key.
 */
export function csvSliceKeyAgainstBq(
  phoneBankName: string,
  isoDate: string,
  bqRows: readonly { campaignId?: string; campaignName: string; callDate: string }[]
): string {
  const nk = normalizeCampaignKey(phoneBankName);
  const ids = [
    ...new Set(
      bqRows
        .filter(
          (r) =>
            r.callDate === isoDate &&
            Boolean(r.campaignId?.trim()) &&
            normalizeCampaignKey(r.campaignName) === nk
        )
        .map((r) => r.campaignId!.trim())
    ),
  ];
  if (ids.length === 1) return makeBqSliceKey(ids[0]!, phoneBankName, isoDate);
  return makeSliceKey(phoneBankName, isoDate);
}

export function sliceKeyMatchesCampaignDate(
  sliceKey: string,
  campaignName: string,
  isoDate: string,
  campaignId?: string
): boolean {
  if (sliceKey === makeSliceKey(campaignName, isoDate)) return true;
  if (campaignId && sliceKey === makeBqSliceKey(campaignId, campaignName, isoDate)) return true;
  return sliceKey.startsWith("id:") && sliceKey.endsWith(`|${isoDate}`);
}

export function tombstoneKeysForRow(row: {
  campaignId?: string;
  campaignName: string;
  callDate: string;
}): string[] {
  const nameKey = makeSliceKey(row.campaignName, row.callDate);
  const bqKey = dailyCallerSliceKey(row);
  return bqKey === nameKey ? [nameKey] : [bqKey, nameKey];
}

export function formatShortUsDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  return `${mm}/${dd}/${String(yyyy % 100).padStart(2, "0")}`;
}
