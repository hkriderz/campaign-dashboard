/** `YYYY-MM-DD` calendar day (no time zone validation). */
export function isValidIsoDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
}
