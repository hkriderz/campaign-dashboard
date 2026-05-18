import { sortAggregateAnswerLines } from "./aggregate-answer-sort";
import { makeSliceKey } from "./slice-key";
import {
  isCanvassResultColumnQuestion,
  isTraciViolationQuestionName,
  questionLooksLikeDisclaimer,
} from "./survey-i18n/rules";
import type { PhonebankerQuestionResponseStat, SurveyScriptProfile } from "./types";

export type AggregateAnswerLine = {
  label: string;
  count: number;
};

export function isFinalResultQuestionName(questionName: string): boolean {
  const t = questionName.trim().toLowerCase();
  if (questionLooksLikeDisclaimer(questionName)) return false;
  if (isCanvassResultColumnQuestion(questionName)) return false;
  return /\bfinal\s*result\b|resultado\s*final/.test(t);
}

/**
 * Label used for Final Result rollups and pivot raw totals. BigQuery rows use split `questionName` + `answerValue`;
 * wide CSV synthesis uses the full script header as `questionName` and leaves `answerValue` empty — extract the
 * option text after "Final result:" / "Resultado final:" so buckets match BQ-style aggregation.
 */
export function effectiveFinalResultAnswerLabelForRollup(questionName: string, answerValue: string): string | null {
  if (!isFinalResultQuestionName(questionName)) return null;
  const av = answerValue.trim();
  if (av && av.toLowerCase() !== "[no answer recorded]") return av;
  const q = questionName.trim();
  const mEn = q.match(/\bfinal\s*result\s*:?\s*(.+)$/i);
  if (mEn?.[1]?.trim()) return mEn[1].trim();
  const mEs = q.match(/\bresultado\s*final\s*:?\s*(.+)$/i);
  if (mEs?.[1]?.trim()) return mEs[1].trim();
  return null;
}

/**
 * STW “horse race” / first-survey style block; excludes final-result and script-only rows.
 * `genericChallenger` (Ada) uses the numbered intro block (e.g. “01 Intro”) instead of the word “Polling”.
 */
export function isPollingQuestionName(
  questionName: string,
  profile: SurveyScriptProfile = "faizahTraci"
): boolean {
  const t = questionName.trim().toLowerCase();
  if (questionLooksLikeDisclaimer(questionName)) return false;
  if (isTraciViolationQuestionName(questionName)) return false;
  if (isCanvassResultColumnQuestion(questionName)) return false;
  if (isFinalResultQuestionName(questionName)) return false;
  if (profile === "genericChallenger") {
    if (
      /\b0?1\s*[-–—.:]?\s*intro(ducci[oó]n)?\b/.test(t) ||
      /\b0?1intro(ducci[oó]n)?\b/.test(t)
    ) {
      return true;
    }
  }
  return /\bpolling\b/.test(t);
}

function sortAnswerLineMap(m: Map<string, number>): AggregateAnswerLine[] {
  const lines = [...m.entries()].map(([label, count]) => ({ label, count }));
  return sortAggregateAnswerLines(lines);
}

/** One BQ or wide-synthetic row → final-result map (same rules as daily aggregate raw lines). */
function addRowToFinalResultMap(
  map: Map<string, number>,
  r: Pick<PhonebankerQuestionResponseStat, "questionName" | "answerValue" | "responseCount">
): void {
  const label = effectiveFinalResultAnswerLabelForRollup(r.questionName, r.answerValue);
  if (!label) return;
  map.set(label, (map.get(label) ?? 0) + r.responseCount);
}

/**
 * Raw per–answer-value totals for Final Result questions only (before Faizah consolidation).
 * Use with `consolidateSurveyAnswerLines` to match Daily Aggregate buckets.
 */
export function rollupFinalResultRawAnswerLines(
  rows: ReadonlyArray<Pick<PhonebankerQuestionResponseStat, "questionName" | "answerValue" | "responseCount">>
): AggregateAnswerLine[] {
  const finalMap = new Map<string, number>();
  for (const r of rows) {
    addRowToFinalResultMap(finalMap, r);
  }
  return sortAnswerLineMap(finalMap);
}

/**
 * Sum distinct-answer counts from BQ question stats for Polling and Final Result blocks,
 * scoped to the same slices / date as the daily aggregate card.
 */
export function rollupPollingAndFinalAnswers(
  rows: PhonebankerQuestionResponseStat[],
  opts: {
    sliceKeys: ReadonlySet<string>;
    dateFilter: string | null;
    surveyScriptProfile?: SurveyScriptProfile;
  }
): {
  polling: AggregateAnswerLine[];
  finalResult: AggregateAnswerLine[];
} {
  const profile = opts.surveyScriptProfile ?? "faizahTraci";
  const pollMap = new Map<string, number>();
  const finalMap = new Map<string, number>();

  for (const r of rows) {
    const sk = makeSliceKey(r.campaignName, r.callDate);
    if (!opts.sliceKeys.has(sk)) continue;
    if (opts.dateFilter && r.callDate !== opts.dateFilter) continue;

    const av = r.answerValue.trim();
    if (!av || av.toLowerCase() === "[no answer recorded]") {
      if (effectiveFinalResultAnswerLabelForRollup(r.questionName, r.answerValue)) {
        addRowToFinalResultMap(finalMap, r);
      }
      continue;
    }

    if (isPollingQuestionName(r.questionName, profile)) {
      pollMap.set(av, (pollMap.get(av) ?? 0) + r.responseCount);
    } else if (isFinalResultQuestionName(r.questionName)) {
      addRowToFinalResultMap(finalMap, r);
    }
  }

  return {
    polling: sortAnswerLineMap(pollMap),
    finalResult: sortAnswerLineMap(finalMap),
  };
}

export function sumAnswerLines(lines: AggregateAnswerLine[]): number {
  return lines.reduce((s, x) => s + x.count, 0);
}
