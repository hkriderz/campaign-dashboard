import { campaignNameMatchesTag, resolveSurveyScriptProfile } from "../campaign-tags";
import {
  classifyKnockSupportResponse,
  isNonContactQuestion,
  isPledgeOrSecondaryQuestion,
} from "../canvassing/overview-tally";
import { isFinalResultQuestionName } from "../daily-aggregate-survey-rollup";
import {
  candidateTermsForTag,
  isExcludedSupportSourceQuestion,
  questionTiesToCandidate,
} from "../strong-support-from-survey";
import { classifiedAnswerIsFinalResultBucket } from "../survey-answer-consolidation";
import type { CampaignTag, SurveyScriptProfile } from "../types";
import { classifyRecontactChange } from "./change";
import { callOccurredBefore, normalizeRecontactPersonId } from "./ids";
import { sortPriorsNewestFirst } from "./pair";
import type {
  PriorContactSummary,
  QcCanvassKnockIndexRow,
  QcRecontactPair,
} from "./types";

/**
 * True when a knock assignment or source filename would belong to this candidate.
 * Future canvassing match uses the same helper as QC vs regular phone-bank lists.
 */
export function knockMatchesPrimaryTag(
  row: Pick<QcCanvassKnockIndexRow, "assignmentName" | "sourceFileName">,
  primaryTag: CampaignTag
): boolean {
  if (campaignNameMatchesTag(row.assignmentName, primaryTag)) return true;
  const fileName = (row.sourceFileName ?? "").trim();
  return Boolean(fileName) && campaignNameMatchesTag(fileName, primaryTag);
}

/**
 * QC canvass checker: Final Result, or a candidate-named ID question with SS / U / SO.
 * Donation, pledge, and non-contact rows are not priors.
 */
export function knockIsQcSupportChecker(
  row: Pick<QcCanvassKnockIndexRow, "question" | "response">,
  primaryTag: CampaignTag,
  profile: SurveyScriptProfile = resolveSurveyScriptProfile(primaryTag)
): boolean {
  if (isNonContactQuestion(row.question) || isPledgeOrSecondaryQuestion(row.question)) return false;
  if (isExcludedSupportSourceQuestion(row.question, profile)) return false;

  const response = row.response.trim();
  if (!response) return false;
  const hasSupportAnswer =
    classifyKnockSupportResponse(response) !== null ||
    classifiedAnswerIsFinalResultBucket(response, profile);
  if (!hasSupportAnswer) return false;

  if (isFinalResultQuestionName(row.question)) return true;
  return questionTiesToCandidate(row.question, candidateTermsForTag(primaryTag));
}

function knockOccurredOn(row: QcCanvassKnockIndexRow): string {
  const stamp = row.occurredAt.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(stamp)) return stamp.slice(0, 10);
  return "";
}

/**
 * Latest canvassing knock for this PDI / PRIMARYID before the QC date.
 * Callers pass the saved knock index from `data/canvassing-reports/knock-index.json`.
 */
export function resolveCanvassPriors(
  pdiId: string,
  primaryTag: CampaignTag,
  beforeDate: string,
  beforeAt: string | undefined,
  knockIndex: readonly QcCanvassKnockIndexRow[] = []
): PriorContactSummary[] {
  const want = normalizeRecontactPersonId(pdiId);
  if (!want || knockIndex.length === 0) return [];

  const profile = resolveSurveyScriptProfile(primaryTag);
  const matches = knockIndex.filter((row) => {
    if (normalizeRecontactPersonId(row.primaryId) !== want) return false;
    if (!knockMatchesPrimaryTag(row, primaryTag)) return false;
    if (!knockIsQcSupportChecker(row, primaryTag, profile)) return false;
    const occurredOn = knockOccurredOn(row);
    if (!occurredOn) return false;
    return callOccurredBefore(occurredOn, row.occurredAt, beforeDate, beforeAt);
  });

  if (!matches.length) return [];

  matches.sort((a, b) => {
    const byStamp = (b.occurredAt || "").localeCompare(a.occurredAt || "");
    if (byStamp !== 0) return byStamp;
    return (b.reportId || "").localeCompare(a.reportId || "");
  });

  const latest = matches[0]!;
  return [
    {
      channel: "canvass",
      pdiId: want,
      actorName: latest.canvasserName,
      occurredOn: knockOccurredOn(latest),
      listOrAssignment: latest.assignmentName || latest.sourceFileName || "",
      resultLabel: latest.response.trim(),
      callAt: latest.occurredAt,
    },
  ];
}

/**
 * Append canvass priors without merging them into the phone-bank prior.
 * Canvass-only matches become `matched`. changeKind uses the latest prior of either channel.
 */
export function mergeCanvassPriorsIntoPairs(
  pairs: readonly QcRecontactPair[],
  primaryTag: CampaignTag,
  knockIndex: readonly QcCanvassKnockIndexRow[],
  profile: SurveyScriptProfile
): QcRecontactPair[] {
  if (!knockIndex.length) return [...pairs];

  return pairs.map((pair) => {
    const canvassPriors = resolveCanvassPriors(
      pair.qc.pdiId,
      primaryTag,
      pair.qc.callDate,
      pair.qc.callAt || undefined,
      knockIndex
    );
    if (!canvassPriors.length) return pair;

    const priors = sortPriorsNewestFirst([...pair.priors, ...canvassPriors]);
    const latest = priors[0];
    const changeKind = latest
      ? classifyRecontactChange(latest.resultLabel, pair.qc.finalResultLabel, profile)
      : pair.changeKind;
    const matchStatus = pair.matchStatus === "no_pdi" ? "no_pdi" : "matched";

    return { ...pair, priors, matchStatus, changeKind };
  });
}
