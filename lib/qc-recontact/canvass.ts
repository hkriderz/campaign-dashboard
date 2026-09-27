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
import { firstClassifiablePrior, sortPriorsNewestFirst } from "./pair";
import type {
  PriorContactSummary,
  QcCanvassKnockIndexRow,
  QcRecontactPair,
} from "./types";

/**
 * True when a knock assignment or source filename would belong to this candidate.
 * QC priors and Unique IDs do not use this. They match the candidate question.
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

function priorFromKnock(latest: QcCanvassKnockIndexRow, pdiId: string): PriorContactSummary {
  return {
    channel: "canvass",
    pdiId,
    actorName: latest.canvasserName,
    occurredOn: knockOccurredOn(latest),
    listOrAssignment: latest.assignmentName || latest.sourceFileName || "",
    resultLabel: latest.response.trim(),
    callAt: latest.occurredAt,
  };
}

/**
 * Support knocks grouped by normalized PDI. Same checker and date requirement
 * as a per-pair scan of the full index.
 */
function indexSupportKnocksByPdi(
  knockIndex: readonly QcCanvassKnockIndexRow[],
  primaryTag: CampaignTag,
  profile: SurveyScriptProfile
): Map<string, QcCanvassKnockIndexRow[]> {
  const byPdi = new Map<string, QcCanvassKnockIndexRow[]>();
  for (const row of knockIndex) {
    const pdi = normalizeRecontactPersonId(row.primaryId);
    if (!pdi) continue;
    if (!knockIsQcSupportChecker(row, primaryTag, profile)) continue;
    if (!knockOccurredOn(row)) continue;
    const list = byPdi.get(pdi);
    if (list) list.push(row);
    else byPdi.set(pdi, [row]);
  }
  return byPdi;
}

function latestKnockBefore(
  candidates: readonly QcCanvassKnockIndexRow[],
  beforeDate: string,
  beforeAt: string | undefined
): QcCanvassKnockIndexRow | null {
  const matches = candidates.filter((row) =>
    callOccurredBefore(knockOccurredOn(row), row.occurredAt, beforeDate, beforeAt)
  );
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const byStamp = (b.occurredAt || "").localeCompare(a.occurredAt || "");
    if (byStamp !== 0) return byStamp;
    return (b.reportId || "").localeCompare(a.reportId || "");
  });
  return matches[0] ?? null;
}

/**
 * Latest canvassing knock for this PDI / PRIMARYID before the QC date.
 * `byPdi` is the once-per-request index from `indexSupportKnocksByPdi`.
 */
function latestSupportKnock(
  pdiId: string,
  beforeDate: string,
  beforeAt: string | undefined,
  byPdi: ReadonlyMap<string, readonly QcCanvassKnockIndexRow[]>
): QcCanvassKnockIndexRow | null {
  const want = normalizeRecontactPersonId(pdiId);
  if (!want) return null;
  const candidates = byPdi.get(want);
  if (!candidates?.length) return null;
  return latestKnockBefore(candidates, beforeDate, beforeAt);
}

export function resolveCanvassPriors(
  pdiId: string,
  primaryTag: CampaignTag,
  beforeDate: string,
  beforeAt: string | undefined,
  knockIndex: readonly QcCanvassKnockIndexRow[] = []
): PriorContactSummary[] {
  const want = normalizeRecontactPersonId(pdiId);
  const profile = resolveSurveyScriptProfile(primaryTag);
  const byPdi = indexSupportKnocksByPdi(knockIndex, primaryTag, profile);
  const latest = latestSupportKnock(pdiId, beforeDate, beforeAt, byPdi);
  if (!want || !latest) return [];
  return [priorFromKnock(latest, want)];
}

function withoutSavedCanvassPriors(pair: QcRecontactPair, profile: SurveyScriptProfile): QcRecontactPair {
  if (!pair.priors.some((prior) => prior.channel === "canvass")) return pair;
  const priors = pair.priors.filter((prior) => prior.channel !== "canvass");
  if (pair.matchStatus === "no_pdi") return { ...pair, priors };
  const source = firstClassifiablePrior(priors);
  return {
    ...pair,
    priors,
    matchStatus: priors.length > 0 ? "matched" : "unmatched",
    changeKind: source
      ? classifyRecontactChange(source.resultLabel, pair.qc.finalResultLabel, profile)
      : "unknown",
  };
}

/**
 * Drop canvass priors saved on the QC snapshot and apply the current knock index.
 * Phone and text priors stay as stored. Unique ID uploads update the knock index
 * without a BigQuery rebuild, so page loads must read that file again.
 */
export function replaceCanvassPriorsFromKnockIndex(
  pairs: readonly QcRecontactPair[],
  primaryTag: CampaignTag,
  knockIndex: readonly QcCanvassKnockIndexRow[],
  profile: SurveyScriptProfile
): QcRecontactPair[] {
  const stripped = pairs.map((pair) => withoutSavedCanvassPriors(pair, profile));
  return mergeCanvassPriorsIntoPairs(stripped, primaryTag, knockIndex, profile);
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

  const byPdi = indexSupportKnocksByPdi(
    knockIndex,
    primaryTag,
    resolveSurveyScriptProfile(primaryTag)
  );

  return pairs.map((pair) => {
    const latest = latestSupportKnock(
      pair.qc.pdiId,
      pair.qc.callDate,
      pair.qc.callAt || undefined,
      byPdi
    );
    if (!latest) return pair;

    const want = normalizeRecontactPersonId(pair.qc.pdiId);
    const canvassPriors = want ? [priorFromKnock(latest, want)] : [];
    if (!canvassPriors.length) return pair;

    const priors = sortPriorsNewestFirst([...pair.priors, ...canvassPriors]);
    const latestPrior = priors[0];
    const changeKind = latestPrior
      ? classifyRecontactChange(latestPrior.resultLabel, pair.qc.finalResultLabel, profile)
      : pair.changeKind;
    const matchStatus = pair.matchStatus === "no_pdi" ? "no_pdi" : "matched";
    const knockName = (latest.voterName ?? "").trim();
    const qc =
      !pair.qc.voterName.trim() && knockName ? { ...pair.qc, voterName: knockName } : pair.qc;

    return { ...pair, qc, priors, matchStatus, changeKind };
  });
}
