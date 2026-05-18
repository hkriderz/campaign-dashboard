/**
 * PDI `POST /flags` expects `flagEntryDate` as an ISO datetime string, not `YYYY-MM-DD` alone.
 * Parsons does: `datetime.strptime(d, "%Y-%m-%d").isoformat()` → e.g. `2026-05-12T00:00:00`.
 */
export function formatPdiFlagEntryDate(flagEntryDate: string): string {
  const trimmed = flagEntryDate.trim();
  if (!trimmed) {
    throw new Error("flagEntryDate is empty");
  }

  // Already ISO-like (from a prior pass or API round-trip)
  if (trimmed.includes("T")) {
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid flagEntryDate: ${flagEntryDate}`);
    }
    const d = new Date(parsed);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
  }

  const datePart = trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new Error(`Invalid flagEntryDate (expected YYYY-MM-DD): ${flagEntryDate}`);
  }

  const [y, m, d] = datePart.split("-").map(Number);
  const check = new Date(y!, m! - 1, d!);
  if (
    check.getFullYear() !== y ||
    check.getMonth() !== m! - 1 ||
    check.getDate() !== d
  ) {
    throw new Error(`Invalid flagEntryDate: ${flagEntryDate}`);
  }

  return `${datePart}T00:00:00`;
}
