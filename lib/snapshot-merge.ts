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

/**
 * Pacific calendar day that a refresh re-reads in full.
 * `queryStartedAt` is when the previous successful queries started. The bound is the
 * start of the Pacific day before that instant, so the merge can replace that whole day
 * without dropping its morning rows, and rows written during the previous run are included.
 */
export function refreshWindowStartDate(queryStartedAtIso: string): string {
  const parsed = DateTime.fromISO(queryStartedAtIso, { setZone: true });
  const instant = parsed.isValid ? parsed : DateTime.fromISO(queryStartedAtIso, { zone: "utc" });
  return instant.setZone(LA).minus({ days: 1 }).startOf("day").toFormat("yyyy-MM-dd");
}

/** Raw cluster bound equivalent to `DATE(column, 'America/Los_Angeles') >= isoDate`. */
export function createdAtOnOrAfterSql(column: string, isoDate: string): string {
  return `${column} >= TIMESTAMP('${isoDate}', 'America/Los_Angeles')`;
}

/**
 * Superset of a Pacific date span so partition/cluster pruning can apply.
 * One calendar day of pad on each side. Callers keep their DATE() filters.
 */
export function paddedCreatedAtRangeSql(column: string, startDate: string, endDate: string): string {
  const start = DateTime.fromISO(startDate, { zone: LA }).minus({ days: 1 }).toFormat("yyyy-MM-dd");
  const endExclusive = DateTime.fromISO(endDate, { zone: LA }).plus({ days: 2 }).toFormat("yyyy-MM-dd");
  return `${column} >= TIMESTAMP('${start}', 'America/Los_Angeles') AND ${column} < TIMESTAMP('${endExclusive}', 'America/Los_Angeles')`;
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

export type TextContactMergeRow = {
  campaignContactId: string;
  campaignId: string;
  campaignName: string;
  pdiId: string;
  texterName: string;
  occurredOn: string;
  occurredAt: string;
  resultLabel: string;
  hasMessages: boolean;
  hasInboundReply: boolean;
};

/**
 * Fold a window of new text activity into stored contacts.
 * Stored PDI ids and inbound replies stay. A later window event can update the label and texter.
 */
export function mergeTextContactWindow<T extends TextContactMergeRow>(
  existing: readonly T[],
  fresh: readonly T[]
): T[] {
  const byId = new Map<string, T>();
  for (const row of existing) {
    if (row.campaignContactId) byId.set(row.campaignContactId, row);
  }
  for (const row of fresh) {
    if (!row.campaignContactId) continue;
    const prev = byId.get(row.campaignContactId);
    if (!prev) {
      byId.set(row.campaignContactId, row);
      continue;
    }
    const freshLater = row.occurredAt > prev.occurredAt;
    byId.set(row.campaignContactId, {
      ...prev,
      pdiId: row.pdiId || prev.pdiId,
      hasInboundReply: prev.hasInboundReply || row.hasInboundReply,
      hasMessages: prev.hasMessages || row.hasMessages,
      occurredAt: freshLater ? row.occurredAt : prev.occurredAt,
      occurredOn: freshLater ? row.occurredOn : prev.occurredOn,
      resultLabel: freshLater && row.resultLabel ? row.resultLabel : prev.resultLabel,
      texterName: freshLater && row.texterName ? row.texterName : prev.texterName,
      campaignId: row.campaignId || prev.campaignId,
      campaignName: row.campaignName || prev.campaignName,
    });
  }
  return [...byId.values()];
}
