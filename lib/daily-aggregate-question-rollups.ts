import { sortAggregateAnswerLines } from "./aggregate-answer-sort";
import {
  effectiveFinalResultAnswerLabelForRollup,
  type AggregateAnswerLine,
} from "./daily-aggregate-survey-rollup";
import { consolidateSurveyAnswerLines } from "./survey-answer-consolidation";
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
  /** Subset of `responseCount` filled from polling/ID when Final Result was missing. */
  synthesizedCount?: number;
};

type AnswerLineAcc = { count: number; synthesized: number };

function sortAnswerLineMap(m: Map<string, AnswerLineAcc>): AggregateAnswerLine[] {
  const lines = [...m.entries()].map(([label, acc]) => ({
    label,
    count: acc.count,
    synthesized: acc.synthesized > 0 ? acc.synthesized : undefined,
  }));
  return sortAggregateAnswerLines(lines);
}

function addAnswerLineAcc(
  map: Map<string, AnswerLineAcc>,
  label: string,
  count: number,
  synthesized = 0
): void {
  const prev = map.get(label) ?? { count: 0, synthesized: 0 };
  prev.count += count;
  prev.synthesized += synthesized;
  map.set(label, prev);
}

/** Flatten overlaid per-slice question rows into Daily Aggregate question-slot input. */
export function aggregateScopeRowsFromQuestionSlices(
  questionRowsBySlice: Record<
    string,
    readonly {
      questionName: string;
      answerValue: string;
      responseCount: number;
      synthesizedCount?: number;
    }[]
  >,
  sliceKeys: ReadonlySet<string>
): AggregateScopeQuestionRow[] {
  const out: AggregateScopeQuestionRow[] = [];
  for (const [sk, rows] of Object.entries(questionRowsBySlice)) {
    if (!sliceKeys.has(sk)) continue;
    for (const r of rows) {
      out.push({
        questionName: r.questionName,
        answerValue: r.answerValue,
        responseCount: r.responseCount,
        synthesizedCount: r.synthesizedCount,
      });
    }
  }
  return out;
}

/** Merge counts for multiple BQ question_name variants (e.g. EN + ES) and sort display rows. */
export function mergeRollupsForQuestionGroup(
  rollups: ReadonlyMap<string, AggregateAnswerLine[]>,
  questionNames: readonly string[],
  profile?: SurveyScriptProfile
): AggregateAnswerLine[] {
  const byGroupKey = new Map<string, { count: number; synthesized: number; displayLabel: string }>();
  for (const qn of questionNames) {
    const lines = rollups.get(qn) ?? [];
    for (const { label, count, synthesized } of lines) {
      const k = surveyAnswerLineGroupKey(label, profile);
      const prev = byGroupKey.get(k);
      if (!prev) {
        byGroupKey.set(k, { count, synthesized: synthesized ?? 0, displayLabel: label });
      } else {
        prev.count += count;
        prev.synthesized += synthesized ?? 0;
        prev.displayLabel = pickDisplayAggregateAnswerLabel(prev.displayLabel, label);
      }
    }
  }
  const byDisplayLabel = new Map<string, AnswerLineAcc>();
  for (const { count, synthesized, displayLabel } of byGroupKey.values()) {
    const formatted = formatAggregateAnswerLineLabel(displayLabel, profile);
    addAnswerLineAcc(byDisplayLabel, formatted, count, synthesized);
  }
  return consolidateSurveyAnswerLines(sortAnswerLineMap(byDisplayLabel), profile ?? "faizahTraci");
}

/**
 * Build per-question answer breakdowns from scoped BQ question stats (same grain as daily aggregate).
 */
export function buildRollupsByQuestionName(
  rows: readonly AggregateScopeQuestionRow[]
): Map<string, AggregateAnswerLine[]> {
  const byQ = new Map<string, Map<string, AnswerLineAcc>>();
  for (const r of rows) {
    const q = r.questionName.trim();
    if (!q) continue;
    const av = r.answerValue.trim();
    const frLabel = effectiveFinalResultAnswerLabelForRollup(q, av);
    const label = (frLabel || av).trim();
    if (!label || label.toLowerCase() === "[no answer recorded]") continue;
    if (!byQ.has(q)) byQ.set(q, new Map());
    addAnswerLineAcc(byQ.get(q)!, label, r.responseCount, r.synthesizedCount ?? 0);
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
