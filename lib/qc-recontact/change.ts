import {
  classifySurveyAnswerDisplayLabel,
  finalResultFamilyForDisplayLabel,
  type FinalResultFamily,
} from "../survey-answer-consolidation";
import type { SurveyScriptProfile } from "../types";
import type { QcRecontactChangeKind } from "./types";

function familyRank(family: FinalResultFamily): number {
  switch (family) {
    case "strongSupport":
      return 3;
    case "undecided":
    case "other":
      return 2;
    case "strongOppose":
      return 1;
    default:
      return 2;
  }
}

export function classifyRecontactChange(
  priorResultLabel: string,
  qcResultLabel: string,
  profile: SurveyScriptProfile
): QcRecontactChangeKind {
  const priorRaw = priorResultLabel.trim();
  const qcRaw = qcResultLabel.trim();
  if (!priorRaw || !qcRaw) return "unknown";

  const priorLabel = classifySurveyAnswerDisplayLabel(priorRaw, profile);
  const qcLabel = classifySurveyAnswerDisplayLabel(qcRaw, profile);
  const priorFamily = finalResultFamilyForDisplayLabel(priorLabel);
  const qcFamily = finalResultFamilyForDisplayLabel(qcLabel);

  if (priorFamily === qcFamily) return "held";
  if (
    (priorFamily === "strongSupport" && qcFamily === "strongOppose") ||
    (priorFamily === "strongOppose" && qcFamily === "strongSupport")
  ) {
    return "flipped";
  }
  const priorRank = familyRank(priorFamily);
  const qcRank = familyRank(qcFamily);
  if (qcRank > priorRank) return "strengthened";
  if (qcRank < priorRank) return "softened";
  return "held";
}
