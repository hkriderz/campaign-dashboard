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

const WERE_YOU_CONTACTED_HINTS = ["were you contacted", "te contactaron", "fue contactad"];

/** Non-blank survey text. `[no answer recorded]` and missing values count as empty. */
export function recordedSurveyAnswer(answerValue: string | undefined | null): string {
  const av = (answerValue ?? "").trim();
  if (!av || av.toLowerCase() === "[no answer recorded]") return "";
  return av;
}

function usableSurveyAnswer(answerValue: string): string {
  return recordedSurveyAnswer(answerValue);
}

/** QC script question asking whether a canvasser (or caller) already reached this voter. */
export function isWereYouContactedQuestion(questionName: string): boolean {
  const n = normalizeSurveyTextForMatching(questionName.trim().toLowerCase());
  if (!n) return false;
  return WERE_YOU_CONTACTED_HINTS.some((hint) => n.includes(hint));
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
): {
  finalResultLabel: string;
  pollingLabel: string;
  canvassLabel: string;
  contactedQuestion: string;
  contactedAnswer: string;
} {
  let finalResultLabel = "";
  let pollingLabel = "";
  let canvassLabel = "";
  let contactedQuestion = "";
  let contactedAnswer = "";
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
    if (isWereYouContactedQuestion(row.questionName)) {
      const av = usableSurveyAnswer(row.answerValue);
      if (av) {
        contactedQuestion = row.questionName.trim();
        contactedAnswer = av;
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

  return { finalResultLabel, pollingLabel, canvassLabel, contactedQuestion, contactedAnswer };
}

/**
 * Older snapshots omitted canvass, polling, or Were you contacted.
 * Fills only the fields that are still empty. Leaves a recorded value in place.
 */
export function fillMissingCanvassLabel(
  qc: RecontactCallSummary,
  rows: readonly RecontactSurveyRow[],
  profile: SurveyScriptProfile,
  terms: readonly string[] = []
): RecontactCallSummary {
  const needsCanvass = !recordedSurveyAnswer(qc.canvassLabel);
  const needsPolling = !recordedSurveyAnswer(qc.pollingLabel);
  const needsContacted = !recordedSurveyAnswer(qc.contactedAnswer);
  if (!needsCanvass && !needsPolling && !needsContacted) return qc;
  if (!rows.length) return qc;

  const labels = extractCallSurveyLabels(rows, profile, terms);
  const next: RecontactCallSummary = { ...qc };
  let changed = false;
  if (needsCanvass && labels.canvassLabel) {
    next.canvassLabel = labels.canvassLabel;
    changed = true;
  }
  if (needsPolling && labels.pollingLabel) {
    next.pollingLabel = labels.pollingLabel;
    changed = true;
  }
  if (needsContacted && labels.contactedAnswer) {
    next.contactedQuestion = labels.contactedQuestion;
    next.contactedAnswer = labels.contactedAnswer;
    changed = true;
  }
  return changed ? next : qc;
}
