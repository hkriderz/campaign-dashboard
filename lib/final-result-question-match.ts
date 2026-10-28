/**
 * Pair a Final Result question with the one earlier script question that asks the same thing.
 * Answer overlap wins. Question wording is only a tiebreaker, so a later "vote" question
 * does not beat the question that shares the Final Result options.
 */

export type ScriptOptionFinalResultMatch = {
  sourceQuestionName: string;
  /** Normalized option text → label to store. Final Result wording wins when both exist. */
  options: Map<string, string>;
};

const STOPWORDS = new Set(["the", "on", "a", "an", "of", "for", "to", "and", "your", "you"]);

function isFinalResultName(questionName: string): boolean {
  const t = questionName.trim().toLowerCase();
  if (/disclaimer|notes/.test(t)) return false;
  return /\bfinal\s*result\b|resultado\s*final/.test(t);
}

function isSourceCandidate(questionName: string): boolean {
  const t = questionName.trim().toLowerCase();
  if (!t || isFinalResultName(questionName)) return false;
  if (/canvass\s*result|contact\s*quality|disclaimer|notes|resultado\s*final/.test(t)) return false;
  return true;
}

/** Drop a leading letter or number so "A. Voting..." and "Voting..." compare equal. */
export function normalizeScriptOption(raw: string): string {
  return raw
    .trim()
    .replace(/^\s*[A-Za-z0-9]{1,2}\s*[\.\)\-:]\s*/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripQuestionIndex(questionName: string): string {
  return questionName.trim().replace(/^\s*\d{1,2}\s*[\.\)\-:]\s*/, "");
}

function contentTokens(text: string): Set<string> {
  const norm = normalizeScriptOption(stripQuestionIndex(text));
  return new Set(norm.split(" ").filter((word) => word.length > 2 && !STOPWORDS.has(word)));
}

function overlapCoefficient(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

function isSubstantive(answer: string): boolean {
  const t = answer.trim();
  return Boolean(t) && t.toLowerCase() !== "[no answer recorded]";
}

/**
 * The earlier question whose answers are the Final Result options.
 * Returns null when no question shares at least two of those options.
 */
export function matchFinalResultSourceQuestion(
  rows: readonly { questionName: string; answerValue: string }[]
): ScriptOptionFinalResultMatch | null {
  const frLabels = new Map<string, Map<string, number>>();
  const sourceLabels = new Map<string, Map<string, Map<string, number>>>();

  for (const row of rows) {
    if (!isSubstantive(row.answerValue)) continue;
    const norm = normalizeScriptOption(row.answerValue);
    if (!norm) continue;
    const label = row.answerValue.trim();
    if (isFinalResultName(row.questionName)) {
      const counts = frLabels.get(norm) ?? new Map<string, number>();
      counts.set(label, (counts.get(label) ?? 0) + 1);
      frLabels.set(norm, counts);
      continue;
    }
    if (!isSourceCandidate(row.questionName)) continue;
    const byNorm = sourceLabels.get(row.questionName) ?? new Map<string, Map<string, number>>();
    const counts = byNorm.get(norm) ?? new Map<string, number>();
    counts.set(label, (counts.get(label) ?? 0) + 1);
    byNorm.set(norm, counts);
    sourceLabels.set(row.questionName, byNorm);
  }

  if (frLabels.size === 0 || sourceLabels.size === 0) return null;

  const frNorms = new Set(frLabels.keys());
  const frNameTokens = new Set<string>();
  for (const row of rows) {
    if (!isFinalResultName(row.questionName)) continue;
    for (const token of contentTokens(row.questionName)) frNameTokens.add(token);
  }

  let bestName: string | null = null;
  let bestShared = 0;
  let bestOverlap = 0;
  let bestDescription = 0;

  for (const [questionName, byNorm] of sourceLabels) {
    const norms = new Set(byNorm.keys());
    let shared = 0;
    for (const norm of norms) {
      if (frNorms.has(norm)) shared += 1;
    }
    if (shared < 2) continue;
    const overlap = shared / Math.min(norms.size, frNorms.size);
    const description = overlapCoefficient(contentTokens(questionName), frNameTokens);
    const better =
      shared > bestShared ||
      (shared === bestShared && overlap > bestOverlap) ||
      (shared === bestShared && overlap === bestOverlap && description > bestDescription);
    if (!better) continue;
    bestName = questionName;
    bestShared = shared;
    bestOverlap = overlap;
    bestDescription = description;
  }

  if (!bestName) return null;
  const source = sourceLabels.get(bestName);
  if (!source) return null;

  const options = new Map<string, string>();
  for (const norm of frNorms) {
    if (!source.has(norm)) continue;
    options.set(norm, preferredLabel(frLabels.get(norm)!) ?? preferredLabel(source.get(norm)!) ?? norm);
  }
  if (options.size < 2) return null;
  return { sourceQuestionName: bestName, options };
}

function preferredLabel(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = -1;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

export function canonicalScriptOption(
  answer: string,
  options: ReadonlyMap<string, string>
): string | null {
  const norm = normalizeScriptOption(answer);
  if (!norm) return null;
  return options.get(norm) ?? null;
}
