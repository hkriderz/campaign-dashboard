import type { AggregateAnswerLine } from "./daily-aggregate-survey-rollup";
import { normalizeSurveyTextForMatching } from "./survey-i18n/rules";

/** Labels from `consolidateSurveyAnswerLines` bucket order — skip re-sorting those rows together. */
const CONSOLIDATED_BUCKET_LABELS = new Set([
  "support faizah",
  "support ada",
  "support eunisses",
  "support other candidate",
  "undecided",
  "undecided — won't vote for traci",
  "undecided — won't vote opponent",
  "support traci",
  "oppose current candidate",
]);

function isConsolidatedBucketRollup(lines: readonly AggregateAnswerLine[]): boolean {
  if (lines.length === 0) return false;
  return lines.every((l) => CONSOLIDATED_BUCKET_LABELS.has(l.label.trim().toLowerCase()));
}

type OrdKey =
  | { mode: "none" }
  | { mode: "letter"; ord: number }
  | { mode: "number"; ord: number };

/** Letter codes like "A." / "82 A." / "A)"; numeric "1." / "2)" */
function extractOrderingKey(label: string): OrdKey {
  const t = label.trim();
  const letterAfterCount = t.match(/^\s*\d+\s+([A-Za-z])\s*[\.\):\-]\s*/);
  if (letterAfterCount) {
    return { mode: "letter", ord: letterAfterCount[1]!.toUpperCase().charCodeAt(0) - 65 };
  }
  const letterLead = t.match(/^\s*([A-Za-z])\s*[\.\):\-]\s*/);
  if (letterLead) {
    return { mode: "letter", ord: letterLead[1]!.toUpperCase().charCodeAt(0) - 65 };
  }
  const numLead = t.match(/^\s*(\d+)\s*[\.\)]\s*/);
  if (numLead) {
    return { mode: "number", ord: parseInt(numLead[1]!, 10) };
  }
  return { mode: "none" };
}

function compareOrdKeys(a: OrdKey, b: OrdKey): number {
  if (a.mode === "none" && b.mode === "none") return 0;
  if (a.mode === "none") return 1;
  if (b.mode === "none") return -1;
  if (a.mode !== b.mode) return a.mode === "letter" ? -1 : 1;
  return a.ord - b.ord;
}

/**
 * Yes / support-style first, then undecided / unsure, then oppose / no / won't.
 * Uses phrase-normalized text so Spanish lines group with English where rules exist.
 */
export function sentimentSortTier(label: string): number {
  const n = normalizeSurveyTextForMatching(label.trim().toLowerCase());

  if (
    /\boppose\b|won'?t\s+donate|won'?t\s+vote|strong\s+oppose|no\s+it\s+should\s+not|does\s+not\s+bother|no\s+should\s+not|no\s+deber[ií]a\s+descalificar|(^|[^a-z])no[\.\)]\s*it|en\s+contra\b|opone\b/i.test(
      n
    ) ||
    /^d[\.\)]\s/i.test(label.trim())
  ) {
    return 2;
  }
  if (
    /\bundecided\b|\bunsure\b|\bnot\s+sure\b|\bindeciso\b|\bno\s+seguro|maybe|indecis/i.test(n) ||
    /^b[\.\)]\s/i.test(label.trim()) ||
    /^c[\.\)]\s.*undecided/i.test(label.trim())
  ) {
    return 1;
  }
  if (
    /\byes\b|\bsupport\b|should\s+disqualify|^a[\.\)]|\bapoya\b|will\s+donate|strong\s+support|s[ií]\s+deber[ií]a\s+descalificar/i.test(
      n
    ) ||
    /^a[\.\)]\s/i.test(label.trim())
  ) {
    return 0;
  }
  return 1;
}

/**
 * Order aggregate answer rows: letter/number prefixes when most lines use them; else sentiment tiers + alphabetical.
 * Skips reordering known consolidated dashboard buckets (preserve Support → … order from consolidation).
 */
export function sortAggregateAnswerLines(lines: readonly AggregateAnswerLine[]): AggregateAnswerLine[] {
  if (lines.length <= 1) return [...lines];
  if (isConsolidatedBucketRollup(lines)) return [...lines];

  const copy = [...lines];
  const keys = copy.map((l) => extractOrderingKey(l.label));
  const letterKeys = keys.filter((k) => k.mode === "letter");
  const numberKeys = keys.filter((k) => k.mode === "number");

  const half = Math.ceil(copy.length / 2);
  if (letterKeys.length >= Math.max(2, half)) {
    copy.sort((a, b) => {
      const c = compareOrdKeys(extractOrderingKey(a.label), extractOrderingKey(b.label));
      if (c !== 0) return c;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
    return copy;
  }

  if (numberKeys.length >= Math.max(2, half)) {
    copy.sort((a, b) => {
      const c = compareOrdKeys(extractOrderingKey(a.label), extractOrderingKey(b.label));
      if (c !== 0) return c;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
    return copy;
  }

  copy.sort((a, b) => {
    const ta = sentimentSortTier(a.label);
    const tb = sentimentSortTier(b.label);
    if (ta !== tb) return ta - tb;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
  return copy;
}
