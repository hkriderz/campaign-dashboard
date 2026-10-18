/**
 * PDI `POST /flags` expects `flagEntryDate` as an ISO datetime.
 * Noon keeps the calendar day we already use on the report and the ledger.
 * Midnight UTC is the previous evening in Pacific time, which is the one-day gap in older exports.
 */
export function formatPdiFlagEntryDate(flagEntryDate: string): string {
  const trimmed = flagEntryDate.trim();
  if (!trimmed) {
    throw new Error("flagEntryDate is empty");
  }

  const datePart = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed)?.[1] ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new Error(`Invalid flagEntryDate (expected YYYY-MM-DD): ${flagEntryDate}`);
  }

  const [y, m, d] = datePart.split("-").map(Number);
  const check = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m! - 1 ||
    check.getUTCDate() !== d
  ) {
    throw new Error(`Invalid flagEntryDate: ${flagEntryDate}`);
  }

  return `${datePart}T12:00:00`;
}
