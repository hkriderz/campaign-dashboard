import { normalizeRecontactPersonId } from "@/lib/qc-recontact/ids";
import type { PdiIdentityRecord } from "./types";

export type PdiIdentityGapTally = {
  /** Distinct PDI / PRIMARY IDs considered. */
  uniqueIdCount: number;
  /** IDs with no voter name on Unique IDs or in the identity store. */
  missingName: number;
  /** IDs with no address in the identity store. */
  missingAddress: number;
  /** IDs missing both name and address. */
  missingBoth: number;
  /** Rows currently saved in the identity store. */
  identitiesSaved: number;
};

export function emptyPdiIdentityGapTally(identitiesSaved = 0): PdiIdentityGapTally {
  return {
    uniqueIdCount: 0,
    missingName: 0,
    missingAddress: 0,
    missingBoth: 0,
    identitiesSaved,
  };
}

/**
 * Count Unique-ID people still missing a name and/or a stored address.
 * `voterName` on each person should already include identity-store stamping when available.
 */
export function countPdiIdentityGaps(
  people: ReadonlyArray<{ personId: string; voterName?: string }>,
  byPdiId: Record<string, PdiIdentityRecord>
): PdiIdentityGapTally {
  const identitiesSaved = Object.keys(byPdiId).length;
  const seen = new Set<string>();
  let missingName = 0;
  let missingAddress = 0;
  let missingBoth = 0;

  for (const person of people) {
    const personId = normalizeRecontactPersonId(person.personId);
    if (!personId || personId === "-" || seen.has(personId)) continue;
    seen.add(personId);

    const record = byPdiId[personId];
    const hasName = Boolean(person.voterName?.trim() || record?.voterName?.trim());
    const hasAddress = Boolean(record?.voterAddress?.trim());

    if (!hasName) missingName += 1;
    if (!hasAddress) missingAddress += 1;
    if (!hasName && !hasAddress) missingBoth += 1;
  }

  return {
    uniqueIdCount: seen.size,
    missingName,
    missingAddress,
    missingBoth,
    identitiesSaved,
  };
}

/** Collapse contact events to one latest nonempty name per person (date-filtered upstream). */
export function peopleNamesFromEvents(
  events: ReadonlyArray<{ personId: string; voterName?: string; occurredOn?: string; occurredAt?: string }>
): Array<{ personId: string; voterName: string }> {
  const byPerson = new Map<string, { voterName: string; stamp: string }>();
  for (const event of events) {
    const personId = normalizeRecontactPersonId(event.personId);
    if (!personId || personId === "-") continue;
    const name = (event.voterName ?? "").trim();
    const stamp = `${event.occurredAt || event.occurredOn || ""}\0${name}`;
    const prev = byPerson.get(personId);
    if (!prev) {
      byPerson.set(personId, { voterName: name, stamp });
      continue;
    }
    // Prefer a nonempty name; otherwise keep whatever is already stored.
    if (!prev.voterName && name) {
      byPerson.set(personId, { voterName: name, stamp });
    }
  }
  return [...byPerson.entries()].map(([personId, value]) => ({
    personId,
    voterName: value.voterName,
  }));
}

export function eventInDateRange(
  occurredOn: string,
  startDate: string,
  endDate: string
): boolean {
  const day = occurredOn.trim();
  if (!day) return !startDate.trim() && !endDate.trim();
  if (startDate.trim() && day < startDate.trim()) return false;
  if (endDate.trim() && day > endDate.trim()) return false;
  return true;
}
