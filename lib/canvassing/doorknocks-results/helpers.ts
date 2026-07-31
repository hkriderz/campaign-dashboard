/**
 * Pure helpers for Doorknocks Results flag matching.
 * Kept free of `server-only` so unit tests and CLIs can import them.
 */

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

/**
 * Fixed or dynamic threshold for a non-contact column.
 * Returns null when the column should use average × multiplier logic.
 */
export function fixedNonContactThreshold(label: string): number | null {
  if (isHostileNonContactLabel(label)) return 1;
  if (isGatedNonContactLabel(label)) return GATED_FLAG_MIN;
  if (isLanguageBarrierNonContactLabel(label)) return LANGUAGE_BARRIER_FLAG_MIN;
  return null;
}
