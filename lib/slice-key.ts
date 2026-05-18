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

export function formatShortUsDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  return `${mm}/${dd}/${String(yyyy % 100).padStart(2, "0")}`;
}
