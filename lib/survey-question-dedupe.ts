import { questionCanonicalGroupKey } from "./survey-i18n/column-label-gloss";
import type { SurveyScriptProfile } from "./types";

/**
 * Stable key for merging translated survey question titles (same logic as table header glosses).
 * @see questionCanonicalGroupKey
 */
export function questionCanonicalKey(raw: string, profile?: SurveyScriptProfile): string {
  return questionCanonicalGroupKey(raw, profile);
}

function scoreEnglishPrimary(name: string): number {
  let score = 0;
  if (/^[0-9]{1,2}\s+[-–—.]/.test(name.trim())) score += 1;
  if (!/[ñáéíóúü¿¡]/i.test(name)) score += 2;
  if (/\bviolations?\b|\bdonation\b|\bpolling\b|\bintro\b|\bresult\b/i.test(name)) score += 1;
  return score;
}

/** Pick one display string for a merged EN/ES group (prefers ASCII / English-looking title). */
/** Prefer English-looking / fuller script text for merged aggregate answer rows. */
export function pickDisplayAggregateAnswerLabel(current: string, candidate: string): string {
  const score = (s: string) => {
    let sc = 0;
    if (!/[ñáéíóúü¿¡]/i.test(s)) sc += 4;
    if (/\b(yes|no|unsure|donate|disqualify|support|undecided|won't|will)\b/i.test(s)) sc += 1;
    return sc;
  };
  return score(candidate) > score(current) ? candidate : current;
}

export function pickDisplayQuestionName(members: readonly string[]): string {
  const uniq = [...new Set(members.map((m) => m.trim()).filter(Boolean))];
  if (uniq.length === 0) return "";
  if (uniq.length === 1) return uniq[0]!;
  const ranked = [...uniq].sort(
    (a, b) => scoreEnglishPrimary(b) - scoreEnglishPrimary(a) || a.length - b.length
  );
  return ranked[0]!;
}

export type QuestionPickerGroup = {
  canonicalKey: string;
  members: string[];
  displayLabel: string;
};

export function groupQuestionNamesForPicker(
  names: readonly string[],
  profile?: SurveyScriptProfile
): QuestionPickerGroup[] {
  const byKey = new Map<string, string[]>();
  for (const n of names) {
    const t = n.trim();
    if (!t) continue;
    const k = questionCanonicalGroupKey(t, profile);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(t);
  }
  const out: QuestionPickerGroup[] = [];
  for (const [canonicalKey, members] of byKey) {
    const uniq = [...new Set(members)];
    out.push({
      canonicalKey,
      members: uniq.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
      displayLabel: pickDisplayQuestionName(uniq),
    });
  }
  return out.sort((a, b) =>
    a.displayLabel.localeCompare(b.displayLabel, undefined, { sensitivity: "base" })
  );
}
