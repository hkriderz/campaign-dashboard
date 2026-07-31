import { DateTime } from "luxon";
import { LA_TIME_ZONE } from "../knock-details-parser";
import type { CanvassingKnockEvent } from "../types";
import type { EnrichedKnockRow } from "./types";

export {
  emptyGapHistogram,
  addToHistogram,
  gapToHistogramBucket,
  histogramTotal,
  histogramToPct,
  rapidBucketShare0to15,
} from "./histogram";

export const NON_CONTACT_QUESTION = "Non-Contact Mobile";

/** Last whitespace-delimited token of voter name (sheet TRIM/RIGHT/SUBSTITUTE logic). */
export function voterLastName(voter: string): string {
  const trimmed = voter.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const parts = trimmed.split(" ");
  return (parts[parts.length - 1] ?? "").trim();
}

export function isNonContactMobile(question: string): boolean {
  return question.trim().toLowerCase() === NON_CONTACT_QUESTION.toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Same household when phone matches (non-empty) OR last name matches.
 * Mirrors sheet: phone OR lastName.
 */
export function isSameHousehold(
  current: Pick<CanvassingKnockEvent, "phone" | "voter"> & { lastName?: string },
  next: Pick<CanvassingKnockEvent, "phone" | "voter"> & { lastName?: string }
): boolean {
  const currentPhone = normalizePhone(current.phone);
  const nextPhone = normalizePhone(next.phone);
  if (currentPhone && nextPhone && currentPhone === nextPhone) return true;

  const currentLast = (current.lastName ?? voterLastName(current.voter)).toLowerCase();
  const nextLast = (next.lastName ?? voterLastName(next.voter)).toLowerCase();
  if (currentLast && nextLast && currentLast === nextLast) return true;

  return false;
}

export function gapSecondsBetween(currentIso: string, nextIso: string): number | null {
  const start = DateTime.fromISO(currentIso);
  const end = DateTime.fromISO(nextIso);
  if (!start.isValid || !end.isValid) return null;
  const seconds = end.diff(start, "seconds").seconds;
  if (!Number.isFinite(seconds)) return null;
  return seconds;
}

/**
 * Derive turf/language stratum from assignment name prefix.
 * e.g. "Esp GG Walk 7-9-26 - 3014018" → "esp"
 *      "Eng GG Walk 7-21-26 - 3014316" → "eng"
 */
export function deriveStratumTag(assignmentName: string): string {
  const trimmed = assignmentName.trim();
  if (!trimmed) return "unknown";
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "unknown";
  if (/^(esp|spa|spanish)/i.test(firstToken)) return "esp";
  if (/^(eng|english)/i.test(firstToken)) return "eng";
  const cleaned = firstToken.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return cleaned || "unknown";
}

export function modeStratumTag(tags: string[]): string {
  if (!tags.length) return "unknown";
  const counts = new Map<string, number>();
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  let best = "unknown";
  let bestCount = 0;
  for (const [tag, count] of counts.entries()) {
    if (count > bestCount) {
      best = tag;
      bestCount = count;
    }
  }
  return best;
}

export function eventIsoDate(occurredAt: string): string | null {
  return DateTime.fromISO(occurredAt, { zone: LA_TIME_ZONE }).toISODate();
}

export function knocksPerHourFromSpan(
  firstAt: string | null,
  lastAt: string | null,
  knockCount: number
): number | null {
  if (!firstAt || !lastAt || knockCount < 2) return null;
  const start = DateTime.fromISO(firstAt);
  const end = DateTime.fromISO(lastAt);
  if (!start.isValid || !end.isValid) return null;
  const hours = end.diff(start, "hours").hours;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return knockCount / hours;
}

export function percentile(sortedAscending: number[], p: number): number | null {
  if (!sortedAscending.length) return null;
  if (sortedAscending.length === 1) return sortedAscending[0]!;
  const clamped = Math.min(1, Math.max(0, p));
  const index = (sortedAscending.length - 1) * clamped;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedAscending[lower]!;
  const weight = index - lower;
  return sortedAscending[lower]! * (1 - weight) + sortedAscending[upper]! * weight;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    let prevDiag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const temp = prev[j]!;
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, prevDiag + cost);
      prevDiag = temp;
    }
  }
  return prev[t.length]!;
}

export function findNearDuplicateNames(names: string[], maxDistance = 2): string[] {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const warnings: string[] = [];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i]!;
      const b = unique[j]!;
      if (Math.abs(a.length - b.length) > maxDistance) continue;
      const dist = levenshtein(a, b);
      if (dist > 0 && dist <= maxDistance) {
        warnings.push(`Possible duplicate canvasser names: "${a}" vs "${b}" (edit distance ${dist}).`);
      }
    }
  }
  return warnings;
}

export function isEligibleNonContactGap(row: EnrichedKnockRow, next: EnrichedKnockRow): boolean {
  return (
    isNonContactMobile(row.question) &&
    isNonContactMobile(next.question) &&
    row.voter !== next.voter &&
    !isSameHousehold(row, next) &&
    row.gapToNextSeconds !== null &&
    row.gapToNextSeconds > 0
  );
}
