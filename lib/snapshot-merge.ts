import { DateTime } from "luxon";

const LA = "America/Los_Angeles";

/** History floor for phone, text, and recontact warehouse queries. */
export const PHONE_HISTORY_START = "2025-12-01";

/**
 * First calendar day of the three-day refresh window in America/Los_Angeles:
 * today, yesterday, and the day before.
 */
export function laThreeDayWindowStart(now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: LA }).minus({ days: 2 }).toFormat("yyyy-MM-dd");
}

export function isOnOrAfterWindow(callDate: string, windowStart: string): boolean {
  return callDate >= windowStart;
}

/**
 * Keep rows strictly before `windowStart` and replace that window with `fresh`.
 * Rows in the window that are absent from `fresh` are dropped.
 */
export function mergeRowsByCallDate<T extends { callDate: string }>(
  existing: readonly T[],
  fresh: readonly T[],
  windowStart: string
): T[] {
  const kept = existing.filter((row) => row.callDate < windowStart);
  const incoming = fresh.filter((row) => row.callDate >= windowStart);
  return [...kept, ...incoming];
}

/** Replace contacts that were active in the window; leave every other contact in place. */
export function upsertById<T>(
  existing: readonly T[],
  fresh: readonly T[],
  idOf: (row: T) => string
): T[] {
  const byId = new Map<string, T>();
  for (const row of existing) {
    const id = idOf(row);
    if (id) byId.set(id, row);
  }
  for (const row of fresh) {
    const id = idOf(row);
    if (id) byId.set(id, row);
  }
  return [...byId.values()];
}
