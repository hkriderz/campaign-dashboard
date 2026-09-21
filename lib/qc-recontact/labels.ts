import {
  effectiveFinalResultAnswerLabelForRollup,
  isPollingQuestionName,
} from "../daily-aggregate-survey-rollup";
import { comparableSupportResultFromRows } from "../strong-support-from-survey";
import {
  classifySurveyAnswerDisplayLabel,
  genericOutcomeDisplayLabel,
} from "../survey-answer-consolidation";
import {
  CORRECT_PERSON_DISPOSITION_HINTS,
  isCanvassResultColumnQuestion,
  normalizeSurveyTextForMatching,
  normalizedQuestionIsCorrectPersonColumn,
  questionLooksLikeDisclaimer,
} from "../survey-i18n/rules";
import type { SurveyScriptProfile } from "../types";
import type { RecontactCallSummary } from "./types";

export type RecontactSurveyRow = {
  questionName: string;
  answerValue: string;
};

const TALKING_TO_CORRECT_PERSON_LABEL = "Talking to Correct Person";

function usableSurveyAnswer(answerValue: string): string {
  const av = answerValue.trim();
  if (!av || av.toLowerCase() === "[no answer recorded]") return "";
  return av;
}

function isAffirmativeSurveyAnswer(answerValue: string): boolean {
  return /^(yes|y|true|1|sí|si)$/i.test(answerValue.trim());
}

function isNegativeSurveyAnswer(answerValue: string): boolean {
  return /^(no|n|false|0)$/i.test(answerValue.trim());
}

function normalizedLooksLikeCorrectPerson(text: string): boolean {
  const n = normalizeSurveyTextForMatching(text.trim().toLowerCase());
  if (!n) return false;
  if (!CORRECT_PERSON_DISPOSITION_HINTS.some((hint) => n.includes(hint))) return false;
  return !/(not\s+(the\s+)?(correct|right)|incorrect|wrong\s+person)/i.test(n);
}

function isCanvassDispositionQuestion(questionName: string): boolean {
  if (isCanvassResultColumnQuestion(questionName)) return true;
  return /(contact\s*quality|canvass\s*result|canvass\s*disposition|call\s*disposition|contact\s*disposition)/i.test(
    questionName
  );
}

/** True when this survey row is a talking-to-correct-person canvass result. */
export function surveyRowIsTalkingToCorrectPerson(
  questionName: string,
  answerValue: string
): boolean {
  const av = usableSurveyAnswer(answerValue);
  if (!av) return false;
  const qNorm = normalizeSurveyTextForMatching(questionName.trim().toLowerCase());
  if (normalizedQuestionIsCorrectPersonColumn(qNorm)) {
    if (/(not\s+(the\s+)?(correct|right)|incorrect|wrong\s+person)/i.test(qNorm)) return false;
    return !isNegativeSurveyAnswer(av);
  }
  if (!isCanvassDispositionQuestion(questionName)) return false;
  return normalizedLooksLikeCorrectPerson(av);
}

/**
 * Stored QC `canvassLabel` is a contact when it is Talking to Correct Person.
 * Legacy split-column snapshots stored `"Yes"` for the selected disposition — treat that as a contact.
 */
export function canvassResultIsTalkingToCorrectPerson(canvassLabel: string): boolean {
  const raw = canvassLabel.trim();
  if (!raw) return false;
  const n = normalizeSurveyTextForMatching(raw.toLowerCase());
  if (/^(yes|y|true|1|sí|si)$/i.test(n)) return true;
  return normalizedLooksLikeCorrectPerson(n);
}

function dispositionFromSplitCanvassQuestion(questionName: string): string {
  const parts = questionName.split(/canvass\s*result\s*-/i);
  return (parts[1] ?? "").trim();
}

function extractCanvassDispositionLabel(questionName: string, answerValue: string): string {
  const av = usableSurveyAnswer(answerValue);
  if (!av || !isCanvassDispositionQuestion(questionName)) return "";
  if (surveyRowIsTalkingToCorrectPerson(questionName, av)) {
    return TALKING_TO_CORRECT_PERSON_LABEL;
  }
  if (isCanvassResultColumnQuestion(questionName)) {
    if (isNegativeSurveyAnswer(av)) return "";
    if (!isAffirmativeSurveyAnswer(av) && !normalizedLooksLikeCorrectPerson(av)) {
      return av;
    }
    return dispositionFromSplitCanvassQuestion(questionName) || av;
  }
  return av;
}

/** Table / CSV / modal result cells — SS / U / SO, never a candidate name. */
export function displayRecontactResultLabel(
  label: string,
  profile: SurveyScriptProfile
): string {
  return genericOutcomeDisplayLabel(label, profile);
}

export function extractCallSurveyLabels(
  rows: readonly RecontactSurveyRow[],
  profile: SurveyScriptProfile,
  terms: readonly string[] = []
): { finalResultLabel: string; pollingLabel: string; canvassLabel: string } {
  let finalResultLabel = "";
  let pollingLabel = "";
  let canvassLabel = "";
  let sawTalkingToCorrectPerson = false;

  for (const row of rows) {
    if (questionLooksLikeDisclaimer(row.questionName)) continue;
    const fr = effectiveFinalResultAnswerLabelForRollup(row.questionName, row.answerValue);
    if (fr) {
      finalResultLabel = classifySurveyAnswerDisplayLabel(fr, profile);
    }
    if (isPollingQuestionName(row.questionName, profile)) {
      const av = usableSurveyAnswer(row.answerValue);
      if (av) {
        pollingLabel = classifySurveyAnswerDisplayLabel(av, profile);
      }
    }
    if (surveyRowIsTalkingToCorrectPerson(row.questionName, row.answerValue)) {
      canvassLabel = TALKING_TO_CORRECT_PERSON_LABEL;
      sawTalkingToCorrectPerson = true;
      continue;
    }
    if (sawTalkingToCorrectPerson) continue;
    const disposition = extractCanvassDispositionLabel(row.questionName, row.answerValue);
    if (disposition) {
      canvassLabel = disposition;
    }
  }

  if (!finalResultLabel) {
    finalResultLabel = comparableSupportResultFromRows(rows, profile, terms);
  }

  return { finalResultLabel, pollingLabel, canvassLabel };
}

/** Older recontact snapshots left `canvassLabel` empty for combined Canvass Result columns. */
export function fillMissingCanvassLabel(
  qc: RecontactCallSummary,
  rows: readonly RecontactSurveyRow[],
  profile: SurveyScriptProfile,
  terms: readonly string[] = []
): RecontactCallSummary {
  if (qc.canvassLabel.trim()) return qc;
  const labels = extractCallSurveyLabels(rows, profile, terms);
  if (!labels.canvassLabel) return qc;
  return { ...qc, canvassLabel: labels.canvassLabel };
}
