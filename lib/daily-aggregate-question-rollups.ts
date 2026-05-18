import { sortAggregateAnswerLines } from "./aggregate-answer-sort";
import type { AggregateAnswerLine } from "./daily-aggregate-survey-rollup";
import {
  formatAggregateAnswerLineLabel,
  questionCanonicalGroupKey,
  surveyAnswerLineGroupKey,
} from "./survey-i18n/column-label-gloss";
import { pickDisplayAggregateAnswerLabel } from "./survey-question-dedupe";
import type { SurveyScriptProfile } from "./types";

export type AggregateScopeQuestionRow = {
  questionName: string;
  answerValue: string;
  responseCount: number;
};

function sortAnswerLineMap(m: Map<string, number>): AggregateAnswerLine[] {
  const lines = [...m.entries()].map(([label, count]) => ({ label, count }));
  return sortAggregateAnswerLines(lines);
}

/** Merge counts for multiple BQ question_name variants (e.g. EN + ES) and sort display rows. */
export function mergeRollupsForQuestionGroup(
  rollups: ReadonlyMap<string, AggregateAnswerLine[]>,
  questionNames: readonly string[],
  profile?: SurveyScriptProfile
): AggregateAnswerLine[] {
  const byGroupKey = new Map<string, { count: number; displayLabel: string }>();
  for (const qn of questionNames) {
    const lines = rollups.get(qn) ?? [];
    for (const { label, count } of lines) {
      const k = surveyAnswerLineGroupKey(label, profile);
      const prev = byGroupKey.get(k);
      if (!prev) {
        byGroupKey.set(k, { count, displayLabel: label });
      } else {
        prev.count += count;
        prev.displayLabel = pickDisplayAggregateAnswerLabel(prev.displayLabel, label);
      }
    }
  }
  const byDisplayLabel = new Map<string, number>();
  for (const { count, displayLabel } of byGroupKey.values()) {
    const formatted = formatAggregateAnswerLineLabel(displayLabel, profile);
    byDisplayLabel.set(formatted, (byDisplayLabel.get(formatted) ?? 0) + count);
  }
  return sortAnswerLineMap(byDisplayLabel);
}

/**
 * Build per-question answer breakdowns from scoped BQ question stats (same grain as daily aggregate).
 */
export function buildRollupsByQuestionName(
  rows: readonly AggregateScopeQuestionRow[]
): Map<string, AggregateAnswerLine[]> {
  const byQ = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const q = r.questionName.trim();
    if (!q) continue;
    const av = r.answerValue.trim();
    if (!av || av.toLowerCase() === "[no answer recorded]") continue;
    if (!byQ.has(q)) byQ.set(q, new Map());
    const m = byQ.get(q)!;
    m.set(av, (m.get(av) ?? 0) + r.responseCount);
  }
  const out = new Map<string, AggregateAnswerLine[]>();
  for (const [q, m] of byQ) {
    out.set(q, sortAnswerLineMap(m));
  }
  return out;
}

export function uniqueQuestionNamesSorted(rows: readonly AggregateScopeQuestionRow[]): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    const q = r.questionName.trim();
    if (q) s.add(q);
  }
  return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** All `question_name` values in this scope that share the same merged-picker key (stable across dates / EN vs ES). */
export function resolveQuestionNamesForCanonicalKey(
  canonicalKey: string,
  rows: readonly AggregateScopeQuestionRow[],
  profile?: SurveyScriptProfile
): string[] {
  const ck = canonicalKey.trim();
  if (!ck) return [];
  return uniqueQuestionNamesSorted(rows).filter((n) => questionCanonicalGroupKey(n, profile) === ck);
}
