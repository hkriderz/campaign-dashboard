import type { SurveyScriptProfile } from "../types";
import {
  classifySurveyAnswerDisplayLabel,
  finalResultFamilyForDisplayLabel,
} from "../survey-answer-consolidation";
import { classifyRecontactChange } from "./change";
import { callOccurredBefore, normalizeRecontactPersonId } from "./ids";
import { canvassResultIsTalkingToCorrectPerson, recordedSurveyAnswer } from "./labels";
import type {
  PriorContactSummary,
  QcRecontactChangeKind,
  QcRecontactPair,
  QcRecontactSelection,
  QcRecontactStats,
  RecontactCallSummary,
  RecontactChannelFilter,
  RecontactMatchFilter,
  RecontactOutcomeFilter,
} from "./types";

export function callSummaryToPhonebankPrior(call: RecontactCallSummary): PriorContactSummary {
  const pdiId = normalizeRecontactPersonId(call.pdiId);
  return {
    channel: "phonebank",
    pdiId,
    actorName: call.phonebankerName,
    occurredOn: call.callDate,
    listOrAssignment: call.campaignName,
    resultLabel: call.finalResultLabel,
    callId: call.callId,
    campaignId: call.campaignId,
    callAt: call.callAt,
    finalResultLabel: call.finalResultLabel,
    pollingLabel: call.pollingLabel,
    canvassLabel: call.canvassLabel,
  };
}

function compareCallsNewestFirst(a: RecontactCallSummary, b: RecontactCallSummary): number {
  const byAt = (b.callAt || "").localeCompare(a.callAt || "");
  if (byAt !== 0) return byAt;
  const byDate = b.callDate.localeCompare(a.callDate);
  if (byDate !== 0) return byDate;
  return b.callId.localeCompare(a.callId);
}

function indexPrimaryCallsByPdi(primaryCalls: readonly RecontactCallSummary[]): Map<string, RecontactCallSummary[]> {
  const byPdi = new Map<string, RecontactCallSummary[]>();
  for (const call of primaryCalls) {
    const pdi = normalizeRecontactPersonId(call.pdiId);
    if (!pdi) continue;
    const list = byPdi.get(pdi) ?? [];
    list.push(call);
    byPdi.set(pdi, list);
  }
  for (const list of byPdi.values()) {
    list.sort(compareCallsNewestFirst);
  }
  return byPdi;
}

function pickLatestPriorBefore(
  qc: RecontactCallSummary,
  candidates: readonly RecontactCallSummary[]
): RecontactCallSummary | null {
  for (const prior of candidates) {
    if (prior.callId && prior.callId === qc.callId) continue;
    if (callOccurredBefore(prior.callDate, prior.callAt, qc.callDate, qc.callAt)) {
      return prior;
    }
  }
  return null;
}

/**
 * Pair each QC call to the latest regular phone-bank call for the same PDI
 * strictly before the QC call. Does not consult canvassing.
 */
export function resolvePhonebankPriors(
  qcCalls: readonly RecontactCallSummary[],
  primaryCalls: readonly RecontactCallSummary[],
  profile: SurveyScriptProfile
): QcRecontactPair[] {
  const byPdi = indexPrimaryCallsByPdi(primaryCalls);

  return [...qcCalls]
    .map((qc) => {
      const pdi = normalizeRecontactPersonId(qc.pdiId);
      const qcNorm: RecontactCallSummary = { ...qc, pdiId: pdi };
      if (!pdi) {
        return {
          pairId: qc.callId,
          qc: qcNorm,
          priors: [],
          matchStatus: "no_pdi" as const,
          changeKind: "unknown" as const,
        };
      }
      const prior = pickLatestPriorBefore(qcNorm, byPdi.get(pdi) ?? []);
      if (!prior) {
        return {
          pairId: qc.callId,
          qc: qcNorm,
          priors: [],
          matchStatus: "unmatched" as const,
          changeKind: "unknown" as const,
        };
      }
      const priors = [callSummaryToPhonebankPrior(prior)];
      return {
        pairId: qc.callId,
        qc: qcNorm,
        priors,
        matchStatus: "matched" as const,
        changeKind: classifyRecontactChange(prior.finalResultLabel, qc.finalResultLabel, profile),
      };
    })
    .sort((a, b) => {
      const byDate = b.qc.callDate.localeCompare(a.qc.callDate);
      if (byDate !== 0) return byDate;
      return a.qc.callId.localeCompare(b.qc.callId);
    });
}

/** Fill identity fields missing from snapshots saved before name, address, and Were you contacted. */
export function withRecontactCallDefaults(qc: RecontactCallSummary): RecontactCallSummary {
  const voterName = qc.voterName ?? "";
  const voterAddress = qc.voterAddress ?? "";
  const contactedQuestion = qc.contactedQuestion ?? "";
  const contactedAnswer = qc.contactedAnswer ?? "";
  if (
    qc.voterName === voterName &&
    qc.voterAddress === voterAddress &&
    qc.contactedQuestion === contactedQuestion &&
    qc.contactedAnswer === contactedAnswer
  ) {
    return qc;
  }
  return { ...qc, voterName, voterAddress, contactedQuestion, contactedAnswer };
}

/** True when the QC call reached the voter (canvass result is talking to correct person). */
export function pairHasQcContact(pair: QcRecontactPair): boolean {
  return canvassResultIsTalkingToCorrectPerson(pair.qc.canvassLabel);
}

/** Strong support, Undecided, or Strong oppose. Blank text and Were you contacted do not count. */
export function isRecordedSupportLabel(label: string, profile: SurveyScriptProfile = "faizahTraci"): boolean {
  const raw = recordedSurveyAnswer(label);
  if (!raw) return false;
  const family = finalResultFamilyForDisplayLabel(classifySurveyAnswerDisplayLabel(raw, profile));
  return family === "strongSupport" || family === "undecided" || family === "strongOppose";
}

/** QC final result or polling is a support answer. Were you contacted alone does not count. */
export function qcCallHasRecordedResponse(
  qc: Pick<RecontactCallSummary, "finalResultLabel" | "pollingLabel">,
  profile: SurveyScriptProfile = "faizahTraci"
): boolean {
  return isRecordedSupportLabel(qc.finalResultLabel, profile) || isRecordedSupportLabel(qc.pollingLabel, profile);
}

/**
 * Contact was made and the QC call recorded a support answer.
 * Talking to the correct person with a blank survey is not useful.
 */
export function pairIsUsefulRecontact(
  pair: QcRecontactPair,
  profile: SurveyScriptProfile = "faizahTraci"
): boolean {
  return pairHasQcContact(pair) && qcCallHasRecordedResponse(pair.qc, profile);
}

/** Drop priors with no support answer and recompute change from the latest one that remains. */
export function pairWithSupportAnswers(
  pair: QcRecontactPair,
  profile: SurveyScriptProfile = "faizahTraci"
): QcRecontactPair {
  const priors = pair.priors.filter((prior) => isRecordedSupportLabel(prior.resultLabel, profile));
  const source = firstClassifiablePrior(priors);
  const changeKind = source
    ? classifyRecontactChange(source.resultLabel, pair.qc.finalResultLabel, profile)
    : "unknown";
  const matchStatus = pair.matchStatus === "no_pdi" ? "no_pdi" : priors.length > 0 ? "matched" : "unmatched";
  return { ...pair, priors, matchStatus, changeKind };
}

export function emptyRecontactSelection(): QcRecontactSelection {
  return { channels: [], outcomes: [], matches: [], canvasser: "" };
}

/** Text prior with a stored false inbound flag. Missing flag (old snapshots) is unknown. */
export function pairHasNoReply(pair: QcRecontactPair): boolean {
  return pair.priors.some((prior) => prior.channel === "text" && prior.hasInboundReply === false);
}

export function pairMatchesChannelChip(pair: QcRecontactPair, channel: RecontactChannelFilter): boolean {
  return pair.priors.some((prior) => prior.channel === channel);
}

export function pairMatchesOutcomeChip(pair: QcRecontactPair, outcome: RecontactOutcomeFilter): boolean {
  if (outcome === "no_reply") return pairHasNoReply(pair);
  return pair.changeKind === outcome;
}

export function pairMatchesMatchChip(pair: QcRecontactPair, match: RecontactMatchFilter): boolean {
  return pair.matchStatus === match;
}

/** Canvass prior actor. Phone and text actors do not match. */
export function pairMatchesCanvasser(pair: QcRecontactPair, canvasser: string): boolean {
  const want = canvasser.trim();
  if (!want) return true;
  return pair.priors.some((prior) => prior.channel === "canvass" && prior.actorName.trim() === want);
}

export function canvasserNamesForPairs(pairs: readonly QcRecontactPair[]): string[] {
  const names = new Set<string>();
  for (const pair of pairs) {
    for (const prior of pair.priors) {
      if (prior.channel !== "canvass") continue;
      const name = prior.actorName.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Empty group = no constraint. Within a group = OR. Across groups = AND.
 */
export function pairMatchesSelections(pair: QcRecontactPair, selection: QcRecontactSelection): boolean {
  if (
    selection.channels.length > 0 &&
    !selection.channels.some((channel) => pairMatchesChannelChip(pair, channel))
  ) {
    return false;
  }
  if (
    selection.outcomes.length > 0 &&
    !selection.outcomes.some((outcome) => pairMatchesOutcomeChip(pair, outcome))
  ) {
    return false;
  }
  if (selection.matches.length > 0 && !selection.matches.some((match) => pairMatchesMatchChip(pair, match))) {
    return false;
  }
  const canvasser = selection.canvasser?.trim() ?? "";
  if (canvasser && !pairMatchesCanvasser(pair, canvasser)) return false;
  return true;
}

export function summarizeRecontactPairs(pairs: readonly QcRecontactPair[]): QcRecontactStats {
  const stats: QcRecontactStats = {
    total: pairs.length,
    matched: 0,
    unmatched: 0,
    noPdi: 0,
    held: 0,
    strengthened: 0,
    softened: 0,
    flipped: 0,
  };
  for (const pair of pairs) {
    if (pair.matchStatus === "matched") stats.matched += 1;
    if (pair.matchStatus === "unmatched") stats.unmatched += 1;
    if (pair.matchStatus === "no_pdi") stats.noPdi += 1;
    if (pair.changeKind === "held") stats.held += 1;
    if (pair.changeKind === "strengthened") stats.strengthened += 1;
    if (pair.changeKind === "softened") stats.softened += 1;
    if (pair.changeKind === "flipped") stats.flipped += 1;
  }
  return stats;
}

export function filterPairsByQcDateRange(
  pairs: readonly QcRecontactPair[],
  startDate: string,
  endDate: string
): QcRecontactPair[] {
  if (!startDate || !endDate) return [...pairs];
  return pairs.filter((pair) => pair.qc.callDate >= startDate && pair.qc.callDate <= endDate);
}

export function changeKindLabel(kind: QcRecontactChangeKind): string {
  switch (kind) {
    case "held":
      return "Held";
    case "strengthened":
      return "Strengthened";
    case "softened":
      return "Softened";
    case "flipped":
      return "Flipped";
    default:
      return "—";
  }
}

export function recontactChannelLabel(channel: PriorContactSummary["channel"]): string {
  switch (channel) {
    case "canvass":
      return "Canvass";
    case "text":
      return "Text";
    default:
      return "Phone bank";
  }
}

function priorSortStamp(prior: PriorContactSummary): string {
  return (prior.callAt || prior.occurredOn || "").trim();
}

export function sortPriorsNewestFirst(priors: readonly PriorContactSummary[]): PriorContactSummary[] {
  return [...priors].sort((a, b) => {
    const byStamp = priorSortStamp(b).localeCompare(priorSortStamp(a));
    if (byStamp !== 0) return byStamp;
    return a.channel.localeCompare(b.channel);
  });
}

/** Newest-first priors: first row with a non-empty result (untagged text does not drive change). */
export function firstClassifiablePrior(
  priors: readonly PriorContactSummary[]
): PriorContactSummary | undefined {
  return sortPriorsNewestFirst(priors).find((prior) => Boolean(prior.resultLabel.trim()));
}
