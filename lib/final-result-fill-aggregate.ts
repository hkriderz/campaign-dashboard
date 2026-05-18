import { makeSliceKey } from "./slice-key";
import {
  SCRIPT_BLOCK_EXCLUSION_REGEX_BODY,
  TRACI_SCRIPT_EXCLUSION_REGEX_BODY,
  isTraciViolationQuestionName,
  normalizeSurveyTextForMatching,
  questionLooksLikeDisclaimer,
} from "./survey-i18n/rules";
import { isFinalResultQuestionName, type AggregateAnswerLine } from "./daily-aggregate-survey-rollup";
import type { CallSurveyRowForFill } from "./types";

const scriptBlockRe = new RegExp(SCRIPT_BLOCK_EXCLUSION_REGEX_BODY, "i");
const traciScriptRe = new RegExp(TRACI_SCRIPT_EXCLUSION_REGEX_BODY, "i");

const CANVASS_DISPOSITION_NAME_RE =
  /(contact\s*quality|canvass\s*result|canvass\s*disposition|call\s*disposition|contact\s*disposition)/i;

/** Same case structure as `question_classification` in `fetchTagDailyCallerStats` (phonebanking.ts). */
function isCanvassDispositionResultQuestion(questionName: string): boolean {
  const q = questionName.trim().toLowerCase();
  if (scriptBlockRe.test(q) || traciScriptRe.test(q)) return false;
  return CANVASS_DISPOSITION_NAME_RE.test(questionName.trim());
}

function isScriptOrTraciBlockQuestion(questionName: string): boolean {
  const q = questionName.trim().toLowerCase();
  return scriptBlockRe.test(q) || traciScriptRe.test(q);
}

/** Mirrors BigQuery `first_structured_answer_per_call` (leading letter + . ) - : etc.). */
function isStructuredSurveyAnswer(answerRaw: string): boolean {
  return /^\s*[0-9A-Za-z][\.\)\-:\s]/.test(answerRaw);
}

/** Drop obvious non–survey outcomes so GOTV / plan text still counts without the STW letter prefix. */
function isWeakDispositionOnlyAnswer(answerValue: string): boolean {
  const t = answerValue.trim();
  if (t.length < 2) return true;
  const n = normalizeSurveyTextForMatching(t.toLowerCase());
  return /^(hung\s*up|hang\s*up|voicemail|wrong\s*number|no\s*answer|declined|n\/?a|none|\?)$/.test(n);
}

function isSubstantiveAnswer(answerValue: string): boolean {
  const t = answerValue.trim();
  if (!t) return false;
  return t.toLowerCase() !== "[no answer recorded]";
}

function latestRowPerQuestion(rows: CallSurveyRowForFill[]): CallSurveyRowForFill[] {
  const m = new Map<string, CallSurveyRowForFill>();
  for (const r of rows) {
    const k = r.questionName;
    const prev = m.get(k);
    if (!prev || r.surveyResultId > prev.surveyResultId) m.set(k, r);
  }
  return [...m.values()];
}

function isEligibleFillSourceQuestion(questionName: string): boolean {
  if (questionLooksLikeDisclaimer(questionName)) return false;
  if (isFinalResultQuestionName(questionName)) return false;
  if (isCanvassDispositionResultQuestion(questionName)) return false;
  if (isScriptOrTraciBlockQuestion(questionName)) return false;
  if (isTraciViolationQuestionName(questionName)) return false;
  return true;
}

/**
 * Per call: if there is already a substantive Final Result answer, skip. Otherwise take the last
 * (by `question_name` sort) eligible non–final-result row with a structured answer — same idea as
 * `fill_final_results` in `stw_to_pdi.py`, without PDI `answer_map`.
 */
export function filledFinalAnswerForCall(rows: CallSurveyRowForFill[]): string | null {
  if (rows.length === 0) return null;
  const collapsed = latestRowPerQuestion(rows);
  const hasGoodFinal = collapsed.some(
    (r) => isFinalResultQuestionName(r.questionName) && isSubstantiveAnswer(r.answerValue)
  );
  if (hasGoodFinal) return null;

  const other = collapsed
    .filter((r) => !isFinalResultQuestionName(r.questionName))
    .sort((a, b) => a.questionName.localeCompare(b.questionName, undefined, { sensitivity: "base" }));

  for (let i = other.length - 1; i >= 0; i--) {
    const r = other[i]!;
    if (!isEligibleFillSourceQuestion(r.questionName)) continue;
    if (!isSubstantiveAnswer(r.answerValue)) continue;
    if (!isStructuredSurveyAnswer(r.answerValue)) continue;
    return r.answerValue.trim();
  }
  for (let i = other.length - 1; i >= 0; i--) {
    const r = other[i]!;
    if (!isEligibleFillSourceQuestion(r.questionName)) continue;
    if (!isSubstantiveAnswer(r.answerValue)) continue;
    if (isWeakDispositionOnlyAnswer(r.answerValue)) continue;
    return r.answerValue.trim();
  }
  return null;
}

export function aggregateFilledFinalResults(
  rows: CallSurveyRowForFill[],
  opts: { sliceKeys: ReadonlySet<string>; dateFilter: string | null }
): AggregateAnswerLine[] {
  const filtered = rows.filter((r) => {
    const sk = makeSliceKey(r.campaignName, r.callDate);
    if (!opts.sliceKeys.has(sk)) return false;
    if (opts.dateFilter && r.callDate !== opts.dateFilter) return false;
    return true;
  });

  const byCall = new Map<string, CallSurveyRowForFill[]>();
  for (const r of filtered) {
    const list = byCall.get(r.callId) ?? [];
    list.push(r);
    byCall.set(r.callId, list);
  }

  const counts = new Map<string, number>();
  for (const [, callRows] of byCall) {
    const label = filledFinalAnswerForCall(callRows);
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}
