import { runQuery, PROJECT, DATASET } from "../bigquery";
import { assertDataAccessAllowed } from "@/lib/credentials/gate";
import {
  loadCallSurveyFillSnapshot,
  loadRecontactPairsSnapshot,
  saveRecontactPairsSnapshot,
  snapshotsDisabled,
} from "../bq-snapshot-store";
import {
  buildTagWhereClause,
  getTagById,
  isDerivedQcTagId,
  resolveSurveyScriptProfile,
} from "../campaign-tags";
import { loadKnockIndexRows } from "../canvassing/knock-index-store";
import { canonicalizePhonebankerName } from "../phonebanker-name";
import { candidateTermsForTag } from "../strong-support-from-survey";
import {
  canvassResultIsTalkingToCorrectPerson,
  extractCallSurveyLabels,
  fillMissingCanvassLabel,
  normalizeRecontactPersonId,
  resolvePhonebankPriors,
  type QcRecontactDetailPayload,
  type QcRecontactPair,
  type QcRecontactSurveyAnswer,
  type RecontactCallSummary,
} from "../qc-recontact";
import { mergeCanvassPriorsIntoPairs } from "../qc-recontact/canvass";
import { mergeTextPriorsIntoPairs } from "../qc-recontact/text";
import { fetchTagCallSurveyRowsForFinalFill } from "./phonebanking";
import { fetchTagTextContacts, fetchTextConversation } from "./text-recontact";
import { toStr, toDateString } from "./bq-row-parsers";
import type { CallSurveyRowForFill, CampaignTag, SurveyScriptProfile } from "../types";

const P = PROJECT;
const D = DATASET;
const PHONEBANK_WINDOW_START_DATE = "2025-12-01";

/** Prefer STW `v1_pdiID`, then older pdi_id keys in `callees.data`. */
const CALLEE_PDI_ID_SQL = `IFNULL(COALESCE(
  REGEXP_EXTRACT(callees.data, r'(?i)"v1_pdiid"\\s*:\\s*"([^"]+)"'),
  REGEXP_EXTRACT(callees.data, r'(?i)"pdi_id"\\s*:\\s*"([^"]+)"'),
  REGEXP_EXTRACT(callees.data, r'(?i)"pdi id"\\s*:\\s*"([^"]+)"'),
  REGEXP_EXTRACT(callees.data, r'(?i)"[^"]*pdi[ _]?id[^"]*"\\s*:\\s*"([^"]+)"')
), "")`;

function requireDashboardDataAccess(): void {
  assertDataAccessAllowed({ gcp: true });
}

export function primaryTagIdFromQc(qcTagId: string): string {
  return isDerivedQcTagId(qcTagId) ? qcTagId.slice(3) : qcTagId;
}

export type PdiSurveyRow = {
  callId: string;
  campaignId: string;
  campaignName: string;
  callDate: string;
  callAt: string;
  phonebankerName: string;
  pdiId: string;
  questionName: string;
  answerValue: string;
};

export function groupRowsIntoCallSummaries(
  rows: readonly PdiSurveyRow[],
  profile: SurveyScriptProfile,
  terms: readonly string[]
): RecontactCallSummary[] {
  const byCall = new Map<string, PdiSurveyRow[]>();
  for (const row of rows) {
    const list = byCall.get(row.callId) ?? [];
    list.push(row);
    byCall.set(row.callId, list);
  }

  const out: RecontactCallSummary[] = [];
  for (const [callId, list] of byCall) {
    const first = list[0]!;
    const labels = extractCallSurveyLabels(list, profile, terms);
    out.push({
      callId,
      campaignId: first.campaignId,
      campaignName: first.campaignName,
      callDate: first.callDate,
      callAt: first.callAt,
      phonebankerName: first.phonebankerName,
      pdiId: first.pdiId,
      ...labels,
    });
  }
  return out;
}

function hydrateRecontactPairsFromSurveyFill(
  pairs: readonly QcRecontactPair[],
  fillRows: readonly CallSurveyRowForFill[],
  profile: SurveyScriptProfile,
  terms: readonly string[]
): QcRecontactPair[] {
  if (!fillRows.length) return [...pairs];
  const byCall = new Map<string, CallSurveyRowForFill[]>();
  for (const row of fillRows) {
    const list = byCall.get(row.callId) ?? [];
    list.push(row);
    byCall.set(row.callId, list);
  }
  return pairs.map((pair) => {
    const rows = byCall.get(pair.qc.callId) ?? [];
    const qc = fillMissingCanvassLabel(pair.qc, rows, profile, terms);
    return qc === pair.qc ? pair : { ...pair, qc };
  });
}

export async function fetchTagPdiSurveyRows(
  tag: CampaignTag,
  options: { requirePdi: boolean }
): Promise<PdiSurveyRow[]> {
  const whereClause = buildTagWhereClause(tag);
  const requirePdiSql = options.requirePdi ? `AND TRIM(${CALLEE_PDI_ID_SQL}) != ""` : "";

  const sql = `
    SELECT
      CAST(calls.id AS STRING) AS call_id,
      CAST(campaigns.id AS STRING) AS campaign_id,
      campaigns.name AS campaign_name,
      CAST(DATETIME(COALESCE(calls.connected_at, calls.created_at), 'America/Los_Angeles') AS DATE) AS call_date,
      FORMAT_DATETIME(
        '%Y-%m-%dT%H:%M:%S',
        DATETIME(COALESCE(calls.connected_at, calls.created_at), 'America/Los_Angeles')
      ) AS call_at,
      callers.name AS phonebanker_name,
      ${CALLEE_PDI_ID_SQL} AS pdi_id,
      COALESCE(survey.question_name, '') AS question_name,
      TRIM(COALESCE(survey.answer_value, '')) AS answer_value
    FROM \`${P}.${D}.survey_results\` survey
    JOIN \`${P}.${D}.calls\` calls
      ON survey.call_id = calls.id
    JOIN \`${P}.${D}.callees\` callees
      ON calls.callee_id = callees.id
    JOIN \`${P}.${D}.callers\` callers
      ON calls.caller_id = callers.id
    JOIN \`${P}.${D}.campaigns\` campaigns
      ON calls.campaign_id = campaigns.id
    WHERE ${whereClause}
      AND DATE(COALESCE(calls.connected_at, calls.created_at), 'America/Los_Angeles') >= '${PHONEBANK_WINDOW_START_DATE}'
      AND survey.deleted_at IS NULL
      AND survey.question_name IS NOT NULL
      ${requirePdiSql}
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);
  return rows.map((r) => ({
    callId: toStr(r.call_id),
    campaignId: toStr(r.campaign_id),
    campaignName: toStr(r.campaign_name),
    callDate: toDateString(r.call_date) ?? "",
    callAt: toStr(r.call_at),
    phonebankerName: canonicalizePhonebankerName(toStr(r.phonebanker_name)),
    pdiId: normalizeRecontactPersonId(toStr(r.pdi_id)),
    questionName: toStr(r.question_name),
    answerValue: toStr(r.answer_value),
  }));
}

export async function buildQcRecontactPairsFromBigQuery(qcTagId: string): Promise<QcRecontactPair[]> {
  const qcTag = getTagById(qcTagId);
  if (!qcTag || !isDerivedQcTagId(qcTagId)) return [];

  const primaryId = primaryTagIdFromQc(qcTagId);
  const primaryTag = getTagById(primaryId);
  if (!primaryTag) return [];

  const profile = resolveSurveyScriptProfile(qcTag);
  const [qcRows, primaryRows, textContacts] = await Promise.all([
    fetchTagPdiSurveyRows(qcTag, { requirePdi: false }),
    fetchTagPdiSurveyRows(primaryTag, { requirePdi: true }),
    fetchTagTextContacts(primaryTag, profile),
  ]);

  const terms = candidateTermsForTag(primaryTag);
  const qcCalls = groupRowsIntoCallSummaries(qcRows, profile, terms).filter((qc) =>
    canvassResultIsTalkingToCorrectPerson(qc.canvassLabel)
  );
  const phonePairs = resolvePhonebankPriors(
    qcCalls,
    groupRowsIntoCallSummaries(primaryRows, profile, terms),
    profile
  );
  const withCanvass = mergeCanvassPriorsIntoPairs(phonePairs, primaryTag, loadKnockIndexRows(), profile);
  return mergeTextPriorsIntoPairs(withCanvass, primaryTag, textContacts, profile);
}

export async function rebuildQcRecontactSnapshot(qcTagId: string): Promise<QcRecontactPair[]> {
  requireDashboardDataAccess();
  const pairs = await buildQcRecontactPairsFromBigQuery(qcTagId);
  saveRecontactPairsSnapshot(qcTagId, pairs, { touchEvenIfUnchanged: true });
  return pairs;
}

export type QcRecontactPagePayload = {
  pairs: QcRecontactPair[];
  hasSnapshot: boolean;
};

/**
 * QC tag page only. Returns null for regular tags so that page never loads this data.
 */
export async function loadQcRecontactPairsForPage(tagId: string): Promise<QcRecontactPagePayload | null> {
  const qcTag = getTagById(tagId);
  if (!isDerivedQcTagId(tagId) || !qcTag) return null;
  requireDashboardDataAccess();

  const primaryTag = getTagById(primaryTagIdFromQc(tagId)) ?? qcTag;
  const profile = resolveSurveyScriptProfile(qcTag);
  const terms = candidateTermsForTag(primaryTag);

  if (snapshotsDisabled()) {
    const pairs = await buildQcRecontactPairsFromBigQuery(tagId);
    return { pairs, hasSnapshot: true };
  }

  const snap = loadRecontactPairsSnapshot(tagId);
  if (!snap) return { pairs: [], hasSnapshot: false };
  const fillRows = loadCallSurveyFillSnapshot(tagId)?.rows ?? [];
  return {
    pairs: hydrateRecontactPairsFromSurveyFill(snap.pairs, fillRows, profile, terms),
    hasSnapshot: true,
  };
}

function answersForCall(rows: readonly CallSurveyRowForFill[], callId: string): QcRecontactSurveyAnswer[] {
  return rows
    .filter((row) => row.callId === callId)
    .map((row) => ({
      questionName: row.questionName,
      answerValue: row.answerValue,
    }));
}

export async function loadQcRecontactDetail(
  qcTagId: string,
  pdiId: string,
  qcCallId: string
): Promise<QcRecontactDetailPayload | null> {
  if (!isDerivedQcTagId(qcTagId)) return null;
  requireDashboardDataAccess();

  const loaded = await loadQcRecontactPairsForPage(qcTagId);
  if (!loaded?.hasSnapshot) return null;

  const wantPdi = normalizeRecontactPersonId(pdiId);
  const pair = loaded.pairs.find(
    (row) => row.qc.callId === qcCallId && normalizeRecontactPersonId(row.qc.pdiId) === wantPdi
  );
  if (!pair) return null;

  const primaryId = primaryTagIdFromQc(qcTagId);
  const priorCallId = pair.priors.find((p) => p.channel === "phonebank")?.callId ?? "";
  const textContactId =
    pair.priors.find((p) => p.channel === "text")?.campaignContactId ??
    pair.priors.find((p) => p.channel === "text")?.callId ??
    "";

  const [qcFill, primaryFill, textThread] = await Promise.all([
    snapshotsDisabled()
      ? fetchTagCallSurveyRowsForFinalFill(qcTagId)
      : Promise.resolve(loadCallSurveyFillSnapshot(qcTagId)?.rows ?? []),
    priorCallId
      ? snapshotsDisabled()
        ? fetchTagCallSurveyRowsForFinalFill(primaryId)
        : Promise.resolve(loadCallSurveyFillSnapshot(primaryId)?.rows ?? [])
      : Promise.resolve([] as CallSurveyRowForFill[]),
    textContactId ? fetchTextConversation(textContactId) : Promise.resolve([]),
  ]);

  return {
    pair,
    qcAnswers: answersForCall(qcFill, pair.qc.callId),
    priorAnswers: priorCallId ? answersForCall(primaryFill, priorCallId) : [],
    textThread,
  };
}
