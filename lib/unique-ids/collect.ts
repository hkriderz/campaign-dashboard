import {
  classifyKnockSupportResponse,
  isOverviewSupportQuestion,
  knockOccurredOnLa,
  type KnockIndexTallyRow,
} from "../canvassing/overview-tally";
import { isFinalResultQuestionName } from "../daily-aggregate-survey-rollup";
import { campaignNameLooksLikeQc } from "../campaign-tags";
import { knockMatchesPrimaryTag } from "../qc-recontact/canvass";
import { normalizeRecontactPersonId } from "../qc-recontact/ids";
import type { QcTextContactSummary, RecontactCallSummary } from "../qc-recontact/types";
import type { CampaignTag, SurveyScriptProfile } from "../types";
import { familyFromKnockOutcome, familyFromResultLabel } from "./classify";
import type { UniqueIdContactEvent } from "./types";

type ClassifiedKnock = KnockIndexTallyRow & {
  personId: string;
  day: string;
  outcome: ReturnType<typeof classifyKnockSupportResponse>;
};

function occurredOnFromStamp(stamp: string): string {
  const trimmed = stamp.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return knockOccurredOnLa(trimmed);
}

function skipQcCampaign(campaignName: string): boolean {
  return campaignNameLooksLikeQc(campaignName);
}

function usablePersonId(raw: string): string {
  const personId = normalizeRecontactPersonId(raw);
  if (!personId || !/[A-Z0-9]/.test(personId)) return "";
  return personId;
}

export function collectPhoneEvents(
  calls: readonly RecontactCallSummary[],
  profile: SurveyScriptProfile
): UniqueIdContactEvent[] {
  const out: UniqueIdContactEvent[] = [];
  for (const call of calls) {
    const personId = usablePersonId(call.pdiId);
    if (!personId) continue;
    if (skipQcCampaign(call.campaignName)) continue;
    const family = familyFromResultLabel(call.finalResultLabel, profile);
    if (!family) continue;
    const occurredAt = call.callAt.trim() || call.callDate;
    const occurredOn = occurredOnFromStamp(occurredAt) || call.callDate;
    if (!occurredOn) continue;
    out.push({
      personId,
      occurredAt,
      occurredOn,
      channel: "phone",
      family,
      campaignName: call.campaignName,
      actorName: call.phonebankerName,
    });
  }
  return out;
}

export function collectTextEvents(
  contacts: readonly QcTextContactSummary[],
  profile: SurveyScriptProfile
): UniqueIdContactEvent[] {
  const out: UniqueIdContactEvent[] = [];
  for (const contact of contacts) {
    const personId = usablePersonId(contact.pdiId);
    if (!personId) continue;
    if (skipQcCampaign(contact.campaignName)) continue;
    const family = familyFromResultLabel(contact.resultLabel, profile);
    if (!family) continue;
    const occurredAt = contact.occurredAt.trim() || contact.occurredOn;
    const occurredOn = contact.occurredOn || occurredOnFromStamp(occurredAt);
    if (!occurredOn) continue;
    out.push({
      personId,
      occurredAt,
      occurredOn,
      channel: "text",
      family,
      campaignName: contact.campaignName,
      actorName: contact.texterName,
    });
  }
  return out;
}

function classifyKnockRow(
  row: KnockIndexTallyRow,
  profile: SurveyScriptProfile
): ClassifiedKnock | null {
  const personId = usablePersonId(row.primaryId);
  const day = knockOccurredOnLa(row.occurredAt);
  if (!personId || !day) return null;
  const outcome = isOverviewSupportQuestion(row.question, profile)
    ? classifyKnockSupportResponse(row.response, profile)
    : null;
  return { ...row, personId, day, outcome };
}

function pickKnockEvent(
  rows: readonly ClassifiedKnock[],
  profile: SurveyScriptProfile
): UniqueIdContactEvent | null {
  const classified = [...rows]
    .filter((row) => row.outcome && isOverviewSupportQuestion(row.question, profile))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (!classified.length) return null;
  const finalResults = classified.filter((row) => isFinalResultQuestionName(row.question));
  const chosen = (finalResults.length ? finalResults : classified).at(-1);
  if (!chosen?.outcome) return null;
  const family = familyFromKnockOutcome(chosen.outcome);
  if (!family) return null;
  return {
    personId: chosen.personId,
    occurredAt: chosen.occurredAt,
    occurredOn: chosen.day,
    channel: "canvass",
    family,
    campaignName: chosen.assignmentName,
    actorName: chosen.canvasserName,
  };
}

/**
 * One canvass event per person × LA day. Latest Final Result that day wins,
 * else the latest ID / horse-race answer.
 */
export function collectKnockEvents(
  rows: readonly KnockIndexTallyRow[],
  options: { tag?: CampaignTag; profile?: SurveyScriptProfile } = {}
): UniqueIdContactEvent[] {
  const profile = options.profile ?? "faizahTraci";
  const tag = options.tag;
  const grouped = new Map<string, ClassifiedKnock[]>();
  for (const row of rows) {
    if (tag && !knockMatchesPrimaryTag(row, tag)) continue;
    const classified = classifyKnockRow(row, profile);
    if (!classified) continue;
    const key = `${classified.personId}|${classified.day}`;
    const list = grouped.get(key) ?? [];
    list.push(classified);
    grouped.set(key, list);
  }
  const out: UniqueIdContactEvent[] = [];
  for (const group of grouped.values()) {
    const event = pickKnockEvent(group, profile);
    if (event) out.push(event);
  }
  return out;
}
