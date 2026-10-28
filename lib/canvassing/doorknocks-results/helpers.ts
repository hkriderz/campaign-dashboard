/**
 * Pure helpers for Doorknocks Results flag matching.
 * Kept free of `server-only` so unit tests and CLIs can import them.
 */

import { canvasserIdentityKey, preferredCanvasserName } from "../display-names";
import type { DoorknockCanvasserRow } from "./types";

export function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Match survey answer labels against bilingual PDI headers like
 * `STRONG SUPPORT/FUERTE APOYO` or `UNDECIDED/INDECISO`.
 *
 * Matches the full answer or any `/`-separated segment after canonicalize.
 * Does not treat `"support"` as a match for `"strong support"`.
 */
export function answerMatches(answer: string, labels: string[]): boolean {
  const value = canonical(answer);
  if (!value || !labels.length) return false;

  const candidates = new Set<string>([value]);
  for (const segment of answer.split("/")) {
    const part = canonical(segment);
    if (part) candidates.add(part);
  }

  return labels.some((label) => {
    const needle = canonical(label);
    return Boolean(needle) && candidates.has(needle);
  });
}

/** Hostile / DNC non-contact columns always flag when count > 0. */
export function isHostileNonContactLabel(label: string): boolean {
  const value = canonical(label);
  if (!value) return false;
  return (
    value.includes("hostile") ||
    value.includes("do not contact") ||
    /(^|\s)dnc(\s|$)/.test(value)
  );
}

export function isGatedNonContactLabel(label: string): boolean {
  return canonical(label).includes("gated");
}

export function isLanguageBarrierNonContactLabel(label: string): boolean {
  const value = canonical(label);
  return value.includes("language barrier") || value.includes("barrera");
}

export const GATED_FLAG_MIN = 25;
export const LANGUAGE_BARRIER_FLAG_MIN = 10;

export const FLAG_DISPOSITIONS = [
  "Hostile",
  "Moved",
  "Deceased",
  "Declined conversation",
  "Gated",
  "Language barrier",
  "Not Home",
] as const;

/** Short flag name. Full bilingual headers stay available on the details line. */
export function shortDispositionLabel(label: string): string {
  const value = canonical(label);
  if (!value) return label.trim();
  if (isHostileNonContactLabel(label)) return "Hostile";
  if (value.includes("declin") || value.includes("rechaz") || value === "decl") return "Declined conversation";
  if (value.includes("deceased") || value.includes("fallec") || value === "d") return "Deceased";
  if (value.includes("moved") || /\bmovi/.test(value) || value === "mv") return "Moved";
  if (value.includes("not home") || value === "nh") return "Not Home";
  if (isGatedNonContactLabel(label) || value === "gtd") return "Gated";
  if (isLanguageBarrierNonContactLabel(label) || value === "lb") return "Language barrier";
  return label.trim();
}

export function isMovedNonContactLabel(label: string): boolean {
  return shortDispositionLabel(label) === "Moved";
}

export function isDeceasedNonContactLabel(label: string): boolean {
  return shortDispositionLabel(label) === "Deceased";
}

/** Hostile, moved, and deceased flag at 1. Every other disposition defaults to 50. */
export function defaultFlagCountThreshold(label: string): number {
  const short = shortDispositionLabel(label);
  if (short === "Hostile" || short === "Moved" || short === "Deceased") return 1;
  return 50;
}

export function flagCountThreshold(label: string, overrides?: Record<string, number> | null): number {
  const key = shortDispositionLabel(label).toLowerCase();
  const override = overrides?.[key];
  if (typeof override === "number" && Number.isFinite(override)) return override;
  return defaultFlagCountThreshold(label);
}

/**
 * Fixed threshold for a non-contact column.
 * Returns null only for an empty label.
 */
export function fixedNonContactThreshold(label: string): number | null {
  if (!canonical(label)) return null;
  return defaultFlagCountThreshold(label);
}

/** Sum turf rows that are the same canvasser into one row before flags run. */
export function mergeCanvasserRows(rows: DoorknockCanvasserRow[]): DoorknockCanvasserRow[] {
  const order: string[] = [];
  const byKey = new Map<string, DoorknockCanvasserRow>();

  for (const row of rows) {
    const key = canvasserIdentityKey(row.canvasserName) || row.canvasserName;
    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, {
        ...row,
        surveyAnswers: { ...row.surveyAnswers },
        nonContacts: { ...row.nonContacts },
      });
      continue;
    }

    existing.canvasserName = preferredCanvasserName([existing.canvasserName, row.canvasserName]);
    existing.doorsKnocked += row.doorsKnocked;
    existing.contacts += row.contacts;
    existing.contactRate = existing.doorsKnocked ? existing.contacts / existing.doorsKnocked : 0;
    for (const [column, value] of Object.entries(row.surveyAnswers)) {
      existing.surveyAnswers[column] = (existing.surveyAnswers[column] ?? 0) + value;
    }
    for (const [column, value] of Object.entries(row.nonContacts)) {
      existing.nonContacts[column] = (existing.nonContacts[column] ?? 0) + value;
    }
    if (!existing.geoCheck && row.geoCheck) existing.geoCheck = row.geoCheck;
    if (!existing.timingCheck && row.timingCheck) existing.timingCheck = row.timingCheck;
    if (!existing.lastSync && row.lastSync) existing.lastSync = row.lastSync;
  }

  return order.map((key) => byKey.get(key)!);
}
