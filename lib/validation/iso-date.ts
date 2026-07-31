/** Strict `YYYY-MM-DD` calendar day validation. */
export function isValidIsoDate(raw: string): boolean {
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function compareIsoDates(a: string, b: string): number {
  return a.localeCompare(b);
}

export function addIsoDays(isoDate: string, days: number): string {
  if (!isValidIsoDate(isoDate)) throw new Error(`Invalid ISO date: ${isoDate}`);
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Subtract calendar days from an ISO date (YYYY-MM-DD). */
export function subtractIsoDays(isoDate: string, days: number): string {
  return addIsoDays(isoDate, -days);
}

export function enumerateIsoDateRange(startDate: string, endDate: string): string[] {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) return [];
  if (compareIsoDates(startDate, endDate) > 0) return [];

  const dates: string[] = [];
  for (let current = startDate; compareIsoDates(current, endDate) <= 0; current = addIsoDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

export function normalizeIsoDateRange(
  startDate: string,
  endDate: string
): { ok: true; startDate: string; endDate: string } | { ok: false; error: string } {
  const start = startDate.trim();
  const end = endDate.trim();
  if (!isValidIsoDate(start)) return { ok: false, error: "Start date must be a valid YYYY-MM-DD date." };
  if (!isValidIsoDate(end)) return { ok: false, error: "End date must be a valid YYYY-MM-DD date." };
  if (compareIsoDates(start, end) > 0) return { ok: false, error: "Start date must be on or before end date." };
  return { ok: true, startDate: start, endDate: end };
}
