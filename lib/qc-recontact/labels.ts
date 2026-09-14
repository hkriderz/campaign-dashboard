import {
  effectiveFinalResultAnswerLabelForRollup,
  isPollingQuestionName,
} from "../daily-aggregate-survey-rollup";
import { comparableSupportResultFromRows } from "../strong-support-from-survey";
import {
  classifySurveyAnswerDisplayLabel,
  genericOutcomeDisplayLabel,
} from "../survey-answer-consolidation";
import { isCanvassResultColumnQuestion, questionLooksLikeDisclaimer } from "../survey-i18n/rules";
import type { SurveyScriptProfile } from "../types";

export type RecontactSurveyRow = {
  questionName: string;
  answerValue: string;
};

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

  for (const row of rows) {
    if (questionLooksLikeDisclaimer(row.questionName)) continue;
    const fr = effectiveFinalResultAnswerLabelForRollup(row.questionName, row.answerValue);
    if (fr) {
      finalResultLabel = classifySurveyAnswerDisplayLabel(fr, profile);
    }
    if (isPollingQuestionName(row.questionName, profile)) {
      const av = row.answerValue.trim();
      if (av && av.toLowerCase() !== "[no answer recorded]") {
        pollingLabel = classifySurveyAnswerDisplayLabel(av, profile);
      }
    }
    if (isCanvassResultColumnQuestion(row.questionName)) {
      const av = row.answerValue.trim();
      if (av && av.toLowerCase() !== "[no answer recorded]") {
        canvassLabel = av;
      }
    }
  }

  if (!finalResultLabel) {
    finalResultLabel = comparableSupportResultFromRows(rows, profile, terms);
  }

  return { finalResultLabel, pollingLabel, canvassLabel };
}
