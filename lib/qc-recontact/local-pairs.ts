import fs from "fs";
import path from "path";
import {
  loadCallSurveyFillSnapshot,
  loadPdiSurveySnapshot,
  loadTextContactsSnapshot,
  loadUniqueIdPhoneSnapshot,
  loadUniqueIdTextSnapshot,
  saveRecontactPairsSnapshot,
  saveUniqueIdPhoneSnapshot,
} from "../bq-snapshot-store";
import { getTagById, isDerivedQcTagId, resolveSurveyScriptProfile } from "../campaign-tags";
import { campaignNameLooksLikeQc } from "../qc-campaign-name";
import {
  buildQcRecontactPairsFromSources,
  groupRowsIntoCallSummaries,
  primaryTagIdFromQc,
  stampFillIdentities,
  type PdiSurveyRow,
} from "../queries/qc-recontact";
import { familyDisplayLabel, familyFromResultLabel } from "../unique-ids/classify";
import { collectPhoneEvents } from "../unique-ids/collect";
import type { UniqueIdContactEvent } from "../unique-ids/types";
import { canonicalizePhonebankerName } from "../phonebanker-name";
import { candidateTermsForTag } from "../strong-support-from-survey";
import type { CallSurveyRowForFill, SurveyScriptProfile } from "../types";
import { normalizeRecontactPersonId } from "./ids";
import type { QcRecontactPair, QcTextContactSummary } from "./types";

const SNAPSHOT_ROOT = path.join(process.cwd(), "data", "bq-snapshots");
const KNOCK_INDEX = path.join(process.cwd(), "data", "canvassing-reports", "knock-index.json");

const localPairCache = new Map<string, { stamp: string; pairs: QcRecontactPair[] }>();

function safeTag(tagId: string): string {
  return tagId.replace(/[^a-z0-9_-]/gi, "");
}

function snapshotPath(tagId: string, fileName: string): string {
  return path.join(SNAPSHOT_ROOT, safeTag(tagId), fileName);
}

function fileStamp(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "0";
  }
}

function sourceStamp(qcTagId: string, primaryId: string): string {
  const names = ["pdi-survey-rows.json", "call-survey-fill.json", "unique-id-phone.json", "unique-id-text.json", "text-contacts.json"];
  const parts = [fileStamp(KNOCK_INDEX)];
  for (const tagId of [qcTagId, primaryId]) {
    for (const name of names) parts.push(fileStamp(snapshotPath(tagId, name)));
  }
  return parts.join("|");
}

function fillToSurvey(rows: readonly CallSurveyRowForFill[]): PdiSurveyRow[] {
  return rows.map((row) => ({
    callId: row.callId,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    callDate: row.callDate,
    callAt: "",
    phonebankerName: row.phonebankerName,
    pdiId: normalizeRecontactPersonId(row.pdiId ?? ""),
    voterName: row.voterName?.trim() ?? "",
    voterAddress: "",
    questionName: row.questionName,
    answerValue: row.answerValue,
  }));
}

/** Keep saved survey rows, fill in a PDI id from the dialer file, and add calls that exist only there. */
export function mergeSurveyRows(base: readonly PdiSurveyRow[], extra: readonly PdiSurveyRow[]): PdiSurveyRow[] {
  const byCall = new Map<string, PdiSurveyRow[]>();
  for (const row of base) {
    const list = byCall.get(row.callId) ?? [];
    list.push(row);
    byCall.set(row.callId, list);
  }
  const extraByCall = new Map<string, PdiSurveyRow[]>();
  for (const row of extra) {
    const list = extraByCall.get(row.callId) ?? [];
    list.push(row);
    extraByCall.set(row.callId, list);
  }
  for (const [callId, extraRows] of extraByCall) {
    const current = byCall.get(callId);
    if (!current) {
      byCall.set(callId, extraRows);
      continue;
    }
    if (current.some((row) => row.pdiId.trim())) continue;
    const pdiId = extraRows.find((row) => row.pdiId.trim())?.pdiId ?? "";
    const voterName = extraRows.find((row) => row.voterName.trim())?.voterName ?? "";
    if (!pdiId) continue;
    byCall.set(
      callId,
      current.map((row) => ({ ...row, pdiId, voterName: row.voterName || voterName }))
    );
  }
  return [...byCall.values()].flat();
}

function eventKey(campaignName: string, day: string, actorName: string): string {
  return `${campaignName.trim().toLowerCase()}|${day}|${canonicalizePhonebankerName(actorName).toLowerCase()}`;
}

/**
 * When a saved survey call has no PDI id, copy it from the one Unique ID event
 * on the same campaign, day, and caller. Ambiguous days stay blank.
 */
export function stampPdiFromUniqueIdEvents(
  rows: readonly PdiSurveyRow[],
  events: readonly UniqueIdContactEvent[],
  profile: SurveyScriptProfile,
  terms: readonly string[]
): PdiSurveyRow[] {
  const byKey = new Map<string, UniqueIdContactEvent[]>();
  for (const event of events) {
    if (event.channel !== "phone" || !event.personId.trim()) continue;
    const key = eventKey(event.campaignName, event.occurredOn, event.actorName);
    const list = byKey.get(key) ?? [];
    list.push(event);
    byKey.set(key, list);
  }
  const byCall = new Map<string, PdiSurveyRow[]>();
  for (const row of rows) {
    const list = byCall.get(row.callId) ?? [];
    list.push(row);
    byCall.set(row.callId, list);
  }
  const out: PdiSurveyRow[] = [];
  for (const list of byCall.values()) {
    if (list.some((row) => row.pdiId.trim())) {
      out.push(...list);
      continue;
    }
    const first = list[0];
    if (!first) continue;
    const candidates = byKey.get(eventKey(first.campaignName, first.callDate, first.phonebankerName)) ?? [];
    const people = [...new Set(candidates.map((event) => normalizeRecontactPersonId(event.personId)).filter(Boolean))];
    let pdiId = people.length === 1 ? people[0] : "";
    if (!pdiId && people.length > 1) {
      const summary = groupRowsIntoCallSummaries(list, profile, terms)[0];
      const family = summary ? familyFromResultLabel(summary.finalResultLabel, profile) : null;
      const matched = family ? candidates.filter((event) => event.family === family) : [];
      const ids = [...new Set(matched.map((event) => normalizeRecontactPersonId(event.personId)).filter(Boolean))];
      if (ids.length === 1) pdiId = ids[0] ?? "";
    }
    if (!pdiId) {
      out.push(...list);
      continue;
    }
    const voterName = candidates.find((event) => normalizeRecontactPersonId(event.personId) === pdiId)?.voterName ?? "";
    out.push(...list.map((row) => ({ ...row, pdiId, voterName: row.voterName || voterName })));
  }
  return out;
}

function eventCovered(rows: readonly PdiSurveyRow[], event: UniqueIdContactEvent): boolean {
  const personId = normalizeRecontactPersonId(event.personId);
  return rows.some(
    (row) =>
      row.pdiId === personId &&
      row.callDate === event.occurredOn &&
      row.campaignName.trim().toLowerCase() === event.campaignName.trim().toLowerCase()
  );
}

/** A Unique ID phone flag that the survey file never stored, shaped so the pair builder can classify it. */
export function rowsFromUniqueIdEvents(events: readonly UniqueIdContactEvent[]): PdiSurveyRow[] {
  const rows: PdiSurveyRow[] = [];
  for (const event of events) {
    if (event.channel !== "phone") continue;
    const pdiId = normalizeRecontactPersonId(event.personId);
    if (!pdiId) continue;
    const callId = `uid:${pdiId}:${event.occurredOn}:${event.campaignName}`;
    const shared = {
      callId,
      campaignId: "",
      campaignName: event.campaignName,
      callDate: event.occurredOn,
      callAt: event.occurredAt,
      phonebankerName: event.actorName,
      pdiId,
      voterName: event.voterName,
      voterAddress: "",
    };
    rows.push(
      { ...shared, questionName: "Final Result", answerValue: familyDisplayLabel(event.family) },
      { ...shared, questionName: "Canvass result", answerValue: "Talking to Correct Person" }
    );
  }
  return rows;
}

function textFromUniqueIds(events: readonly UniqueIdContactEvent[]): QcTextContactSummary[] {
  return events
    .filter((event) => event.channel === "text" && normalizeRecontactPersonId(event.personId))
    .map((event) => ({
      campaignContactId: `uid-text:${event.personId}:${event.occurredOn}`,
      campaignId: "",
      campaignName: event.campaignName,
      pdiId: normalizeRecontactPersonId(event.personId),
      texterName: event.actorName,
      occurredOn: event.occurredOn,
      occurredAt: event.occurredAt || event.occurredOn,
      resultLabel: familyDisplayLabel(event.family),
      hasMessages: true,
      hasInboundReply: false,
    }));
}

function phoneEventKey(event: UniqueIdContactEvent): string {
  return [
    normalizeRecontactPersonId(event.personId),
    event.occurredOn,
    event.campaignName.trim().toLowerCase(),
    event.channel,
  ].join("|");
}

/** Fresh survey events win. Unique ID flags the survey file does not cover stay. */
export function mergeUniqueIdPhoneEvents(
  fresh: readonly UniqueIdContactEvent[],
  existing: readonly UniqueIdContactEvent[]
): UniqueIdContactEvent[] {
  const phoneFresh = fresh.filter((event) => event.channel === "phone");
  const covered = new Set(phoneFresh.map(phoneEventKey));
  const kept = existing.filter((event) => event.channel === "phone" && !covered.has(phoneEventKey(event)));
  return [...phoneFresh, ...kept];
}

type LocalQcSources = {
  pairs: QcRecontactPair[];
  qcRows: PdiSurveyRow[];
  profile: SurveyScriptProfile;
  terms: readonly string[];
};

/**
 * QC pairs from files a normal refresh already saved. Does not query BigQuery.
 * Returns null when this tag has no local phone, text, or unique-id files yet.
 */
async function loadLocalQcSources(qcTagId: string): Promise<LocalQcSources | null> {
  const qcTag = getTagById(qcTagId);
  if (!qcTag || !isDerivedQcTagId(qcTagId)) return null;
  const primaryId = primaryTagIdFromQc(qcTagId);
  const primaryTag = getTagById(primaryId);
  if (!primaryTag) return null;

  const profile = resolveSurveyScriptProfile(qcTag);
  const terms = candidateTermsForTag(primaryTag);
  const qcFill = loadCallSurveyFillSnapshot(qcTagId)?.rows ?? [];
  const primaryFill = loadCallSurveyFillSnapshot(primaryId)?.rows ?? [];
  const qcPdi = loadPdiSurveySnapshot(qcTagId)?.rows ?? [];
  const primaryPdi = loadPdiSurveySnapshot(primaryId)?.rows ?? [];
  const qcUid = loadUniqueIdPhoneSnapshot(qcTagId)?.rows ?? [];
  const primaryUid = (loadUniqueIdPhoneSnapshot(primaryId)?.rows ?? []).filter(
    (event) => !campaignNameLooksLikeQc(event.campaignName)
  );
  const textSnapshot = loadTextContactsSnapshot(primaryId)?.rows ?? [];
  const textUid = loadUniqueIdTextSnapshot(primaryId)?.rows ?? [];

  const hasSource =
    qcFill.length + primaryFill.length + qcPdi.length + primaryPdi.length + qcUid.length + primaryUid.length > 0;
  if (!hasSource) return null;

  const stampedQcFill = qcFill.some((row) => row.calleeId && !row.pdiId)
    ? await stampFillIdentities(qcFill, false)
    : qcFill;
  const stampedPrimaryFill = primaryFill.some((row) => row.calleeId && !row.pdiId)
    ? await stampFillIdentities(primaryFill, false)
    : primaryFill;

  let qcRows = mergeSurveyRows(qcPdi, fillToSurvey(stampedQcFill));
  let primaryRows = mergeSurveyRows(primaryPdi, fillToSurvey(stampedPrimaryFill));
  qcRows = stampPdiFromUniqueIdEvents(qcRows, qcUid, profile, terms);
  primaryRows = stampPdiFromUniqueIdEvents(primaryRows, primaryUid, profile, terms);

  const qcSynthetic = rowsFromUniqueIdEvents(qcUid).filter((row) => {
    const event = qcUid.find(
      (item) =>
        item.channel === "phone" &&
        normalizeRecontactPersonId(item.personId) === row.pdiId &&
        item.occurredOn === row.callDate &&
        item.campaignName === row.campaignName
    );
    return event ? !eventCovered(qcRows, event) : false;
  });
  const primarySynthetic = rowsFromUniqueIdEvents(primaryUid).filter((row) => {
    const event = primaryUid.find(
      (item) =>
        item.channel === "phone" &&
        normalizeRecontactPersonId(item.personId) === row.pdiId &&
        item.occurredOn === row.callDate &&
        item.campaignName === row.campaignName
    );
    return event ? !eventCovered(primaryRows, event) : false;
  });
  qcRows = [...qcRows, ...qcSynthetic];
  primaryRows = [...primaryRows, ...primarySynthetic];

  const textContacts = textSnapshot.length ? textSnapshot : textFromUniqueIds(textUid);
  const pairs = buildQcRecontactPairsFromSources(qcTagId, qcRows, primaryRows, textContacts);
  return { pairs, qcRows, profile, terms };
}

/** QC pairs from files a normal refresh already saved. Does not query BigQuery. */
export async function buildQcRecontactPairsFromLocalFiles(qcTagId: string): Promise<QcRecontactPair[] | null> {
  const primaryId = primaryTagIdFromQc(qcTagId);
  const stamp = sourceStamp(qcTagId, primaryId);
  const cached = localPairCache.get(qcTagId);
  if (cached && cached.stamp === stamp) return cached.pairs;
  const loaded = await loadLocalQcSources(qcTagId);
  if (!loaded) return null;
  localPairCache.set(qcTagId, { stamp, pairs: loaded.pairs });
  return loaded.pairs;
}

/**
 * Rewrite this QC tag's pair file and phone Unique ID file from the saved history.
 * Does not query BigQuery. Flags already stored on the Unique ID file are kept
 * when the survey rows do not cover that person, day, and campaign.
 */
export async function syncQcAnalysisFromLocalFiles(qcTagId: string): Promise<void> {
  const loaded = await loadLocalQcSources(qcTagId);
  if (!loaded) return;
  const existing = loadUniqueIdPhoneSnapshot(qcTagId)?.rows ?? [];
  const calls = groupRowsIntoCallSummaries(loaded.qcRows, loaded.profile, loaded.terms);
  const fresh = collectPhoneEvents(calls, loaded.profile, { includeQcCampaigns: true });
  saveUniqueIdPhoneSnapshot(qcTagId, mergeUniqueIdPhoneEvents(fresh, existing), {
    touchEvenIfUnchanged: true,
  });
  saveRecontactPairsSnapshot(qcTagId, loaded.pairs, { touchEvenIfUnchanged: true });
  localPairCache.delete(qcTagId);
}
