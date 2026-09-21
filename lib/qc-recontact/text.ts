import { campaignNameLooksLikeQc, campaignNameMatchesTag } from "../campaign-tags";
import {
  classifiedAnswerIsFinalResultBucket,
  classifySurveyAnswerDisplayLabel,
  finalResultFamilyForDisplayLabel,
} from "../survey-answer-consolidation";
import { classifyTextContactTag } from "../texting-tag-labels";
import type { CampaignTag, SurveyScriptProfile } from "../types";
import { classifyRecontactChange } from "./change";
import { callOccurredBefore, normalizeRecontactPersonId } from "./ids";
import { firstClassifiablePrior, sortPriorsNewestFirst } from "./pair";
import type {
  PriorContactSummary,
  QcRecontactPair,
  QcTextContactSummary,
} from "./types";

function occurredOnFromStamp(stamp: string): string {
  const trimmed = stamp.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return "";
}

/**
 * Map a raw STW Text tag onto a change-comparable result.
 * Moved tags are not outcomes. "Neither" ranks with Undecided.
 */
export function textTagToResultLabel(
  rawTagName: string,
  candidateTagId: string,
  profile: SurveyScriptProfile
): string {
  const classified = classifyTextContactTag(rawTagName, candidateTagId);
  if (classified.kind === "moved") return "";
  const answer = classified.answer.trim();
  if (!answer || answer === "[No tag]") return "";
  if (/^neither$/i.test(answer)) return "Undecided";
  if (classified.kind === "support") return answer;
  if (classifiedAnswerIsFinalResultBucket(answer, profile)) return answer;
  const mapped = classifySurveyAnswerDisplayLabel(answer, profile);
  if (finalResultFamilyForDisplayLabel(mapped) !== "other") return mapped;
  return "";
}

export function pickTextResultLabel(
  tagNames: readonly string[],
  candidateTagId: string,
  profile: SurveyScriptProfile
): string {
  for (const raw of tagNames) {
    const label = textTagToResultLabel(raw, candidateTagId, profile);
    if (label) return label;
  }
  return "";
}

export function textContactToPrior(contact: QcTextContactSummary): PriorContactSummary {
  const pdiId = normalizeRecontactPersonId(contact.pdiId);
  const occurredAt = contact.occurredAt.trim() || contact.occurredOn;
  return {
    channel: "text",
    pdiId,
    actorName: contact.texterName,
    occurredOn: contact.occurredOn || occurredOnFromStamp(occurredAt),
    listOrAssignment: contact.campaignName,
    resultLabel: contact.resultLabel,
    callId: contact.campaignContactId,
    campaignId: contact.campaignId,
    callAt: occurredAt,
    campaignContactId: contact.campaignContactId,
    finalResultLabel: contact.resultLabel,
    hasInboundReply: contact.hasInboundReply,
  };
}

function compareTextContactsNewestFirst(a: QcTextContactSummary, b: QcTextContactSummary): number {
  const byAt = (b.occurredAt || "").localeCompare(a.occurredAt || "");
  if (byAt !== 0) return byAt;
  const byDate = b.occurredOn.localeCompare(a.occurredOn);
  if (byDate !== 0) return byDate;
  return b.campaignContactId.localeCompare(a.campaignContactId);
}

function contactWasTexted(contact: QcTextContactSummary): boolean {
  return contact.hasMessages || Boolean(contact.resultLabel.trim());
}

function contactMatchesPrimaryTag(contact: QcTextContactSummary, primaryTag: CampaignTag): boolean {
  if (campaignNameLooksLikeQc(contact.campaignName)) return false;
  return campaignNameMatchesTag(contact.campaignName, primaryTag);
}

function indexTextContactsByPdi(
  contacts: readonly QcTextContactSummary[],
  primaryTag: CampaignTag
): Map<string, QcTextContactSummary[]> {
  const byPdi = new Map<string, QcTextContactSummary[]>();
  for (const contact of contacts) {
    const pdi = normalizeRecontactPersonId(contact.pdiId);
    if (!pdi) continue;
    if (!contactWasTexted(contact)) continue;
    if (!contactMatchesPrimaryTag(contact, primaryTag)) continue;
    const list = byPdi.get(pdi) ?? [];
    list.push({ ...contact, pdiId: pdi });
    byPdi.set(pdi, list);
  }
  for (const list of byPdi.values()) {
    list.sort(compareTextContactsNewestFirst);
  }
  return byPdi;
}

function pickLatestTextBefore(
  qcDate: string,
  qcAt: string | undefined,
  candidates: readonly QcTextContactSummary[]
): QcTextContactSummary | null {
  for (const prior of candidates) {
    if (callOccurredBefore(prior.occurredOn, prior.occurredAt, qcDate, qcAt)) {
      return prior;
    }
  }
  return null;
}

export function changeKindFromPriors(
  priors: readonly PriorContactSummary[],
  qcResultLabel: string,
  profile: SurveyScriptProfile
) {
  const latestWithResult = firstClassifiablePrior(priors);
  if (!latestWithResult) {
    return classifyRecontactChange("", qcResultLabel, profile);
  }
  return classifyRecontactChange(latestWithResult.resultLabel, qcResultLabel, profile);
}

/**
 * Latest STW Text contact for this PDI strictly before the QC call.
 * Callers pass compact rows from `l11_stw_txt` (no conversation body).
 */
export function resolveTextPriors(
  pdiId: string,
  primaryTag: CampaignTag,
  beforeDate: string,
  beforeAt: string | undefined,
  contacts: readonly QcTextContactSummary[]
): PriorContactSummary[] {
  const want = normalizeRecontactPersonId(pdiId);
  if (!want || contacts.length === 0) return [];
  const byPdi = indexTextContactsByPdi(contacts, primaryTag);
  const prior = pickLatestTextBefore(beforeDate, beforeAt, byPdi.get(want) ?? []);
  return prior ? [textContactToPrior(prior)] : [];
}

/**
 * Append a text prior without merging it into phone-bank or canvass.
 * Text-only matches become `matched`. changeKind uses the latest prior that has a result.
 */
export function mergeTextPriorsIntoPairs(
  pairs: readonly QcRecontactPair[],
  primaryTag: CampaignTag,
  contacts: readonly QcTextContactSummary[],
  profile: SurveyScriptProfile
): QcRecontactPair[] {
  if (!contacts.length) return [...pairs];

  const byPdi = indexTextContactsByPdi(contacts, primaryTag);

  return pairs.map((pair) => {
    const pdi = normalizeRecontactPersonId(pair.qc.pdiId);
    const prior = pdi
      ? pickLatestTextBefore(pair.qc.callDate, pair.qc.callAt || undefined, byPdi.get(pdi) ?? [])
      : null;
    if (!prior) return pair;

    const priors = sortPriorsNewestFirst([...pair.priors, textContactToPrior(prior)]);
    const matchStatus = pair.matchStatus === "no_pdi" ? "no_pdi" : "matched";
    return {
      ...pair,
      priors,
      matchStatus,
      changeKind: changeKindFromPriors(priors, pair.qc.finalResultLabel, profile),
    };
  });
}
