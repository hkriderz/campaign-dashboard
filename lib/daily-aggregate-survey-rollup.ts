import { sortAggregateAnswerLines } from "./aggregate-answer-sort";
import { dailyCallerSliceKey } from "./slice-key";
import { isCandidateIdSupportQuestion } from "./strong-support-from-survey";
import {
  isCanvassResultColumnQuestion,
  isTraciViolationQuestionName,
  questionLooksLikeDisclaimer,
} from "./survey-i18n/rules";
import type { PhonebankerQuestionResponseStat, SurveyScriptProfile } from "./types";

export type AggregateAnswerLine = {
  label: string;
  count: number;
  /** Subset of `count` filled from polling/ID when Final Result was missing. */
  synthesized?: number;
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

type AnswerLineAcc = { count: number; synthesized: number };

function sortAnswerLineMap(m: Map<string, AnswerLineAcc>): AggregateAnswerLine[] {
  const lines = [...m.entries()].map(([label, acc]) => ({
    label,
    count: acc.count,
    synthesized: acc.synthesized > 0 ? acc.synthesized : undefined,
  }));
  return sortAggregateAnswerLines(lines);
}

function addToLineAcc(map: Map<string, AnswerLineAcc>, label: string, count: number, synthesized = 0): void {
  const prev = map.get(label) ?? { count: 0, synthesized: 0 };
  prev.count += count;
  prev.synthesized += synthesized;
  map.set(label, prev);
}

/** One BQ or wide-synthetic row → final-result map (same rules as daily aggregate raw lines). */
function addRowToFinalResultMap(
  map: Map<string, AnswerLineAcc>,
  r: Pick<PhonebankerQuestionResponseStat, "questionName" | "answerValue" | "responseCount"> & {
    synthesizedCount?: number;
  }
): void {
  const label = effectiveFinalResultAnswerLabelForRollup(r.questionName, r.answerValue);
  if (!label) return;
  addToLineAcc(map, label, r.responseCount, r.synthesizedCount ?? 0);
}

/**
 * Raw per–answer-value totals for Final Result questions only (before Faizah consolidation).
 * Use with `consolidateSurveyAnswerLines` to match Daily Aggregate buckets.
 */
export function rollupFinalResultRawAnswerLines(
  rows: ReadonlyArray<
    Pick<PhonebankerQuestionResponseStat, "questionName" | "answerValue" | "responseCount"> & {
      synthesizedCount?: number;
    }
  >
): AggregateAnswerLine[] {
  const finalMap = new Map<string, AnswerLineAcc>();
  for (const r of rows) {
    addRowToFinalResultMap(finalMap, r);
  }
  return sortAnswerLineMap(finalMap);
}

function campaignGroupKey(row: Pick<PhonebankerQuestionResponseStat, "campaignId" | "campaignName">): string {
  const id = row.campaignId?.trim() ?? "";
  return id ? `id:${id}` : `name:${row.campaignName.trim().toLowerCase()}`;
}

function isRecordedAnswer(answerValue: string): boolean {
  const t = answerValue.trim();
  return Boolean(t) && t.toLowerCase() !== "[no answer recorded]";
}

function answersByQuestion(
  rows: readonly Pick<PhonebankerQuestionResponseStat, "questionName" | "answerValue">[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.questionName) ?? [];
    list.push(row.answerValue);
    map.set(row.questionName, list);
  }
  return map;
}

/**
 * Sum distinct-answer counts from BQ question stats for Polling and Final Result blocks,
 * scoped to the same slices / date as the daily aggregate card.
 *
 * Polling preset: named Polling / Intro questions when present for a campaign; otherwise
 * candidate support/ID asks (same fallback as the outcome tally strip).
 */
export function rollupPollingAndFinalAnswers(
  rows: PhonebankerQuestionResponseStat[],
  opts: {
    sliceKeys: ReadonlySet<string>;
    dateFilter: string | null;
    surveyScriptProfile?: SurveyScriptProfile;
    /** Candidate name terms for ID-ask fallback when a bank has no Polling block. */
    candidateTerms?: readonly string[];
  }
): {
  polling: AggregateAnswerLine[];
  finalResult: AggregateAnswerLine[];
} {
  const profile = opts.surveyScriptProfile ?? "faizahTraci";
  const terms = opts.candidateTerms ?? [];
  const finalMap = new Map<string, AnswerLineAcc>();
  const byCampaign = new Map<string, PhonebankerQuestionResponseStat[]>();

  for (const r of rows) {
    const sk = dailyCallerSliceKey(r);
    if (!opts.sliceKeys.has(sk)) continue;
    if (opts.dateFilter && r.callDate !== opts.dateFilter) continue;

    if (effectiveFinalResultAnswerLabelForRollup(r.questionName, r.answerValue)) {
      addRowToFinalResultMap(finalMap, r);
    }

    const key = campaignGroupKey(r);
    const list = byCampaign.get(key) ?? [];
    list.push(r);
    byCampaign.set(key, list);
  }

  const pollMap = new Map<string, AnswerLineAcc>();
  for (const campaignRows of byCampaign.values()) {
    const byQuestion = answersByQuestion(campaignRows);
    const pollingRows = campaignRows.filter(
      (row) => isPollingQuestionName(row.questionName, profile) && isRecordedAnswer(row.answerValue)
    );
    const idRows =
      terms.length === 0
        ? []
        : campaignRows.filter(
            (row) =>
              isRecordedAnswer(row.answerValue) &&
              !isFinalResultQuestionName(row.questionName) &&
              isCandidateIdSupportQuestion(
                row.questionName,
                terms,
                profile,
                byQuestion.get(row.questionName)
              )
          );
    const source = pollingRows.length > 0 ? pollingRows : idRows;
    for (const row of source) {
      addToLineAcc(pollMap, row.answerValue.trim(), row.responseCount);
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

/** Combine independently rolled-up answer lists (e.g. per-tag polling) by label. */
export function mergeAggregateAnswerLines(groups: readonly AggregateAnswerLine[][]): AggregateAnswerLine[] {
  const map = new Map<string, AnswerLineAcc>();
  for (const lines of groups) {
    for (const line of lines) {
      const label = line.label.trim();
      if (!label) continue;
      addToLineAcc(map, label, line.count, line.synthesized ?? 0);
    }
  }
  return sortAnswerLineMap(map);
}
