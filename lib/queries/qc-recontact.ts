import { cache } from "react";
import { runQuery, PROJECT, DATASET } from "../bigquery";
import { assertDataAccessAllowed } from "@/lib/credentials/gate";
import { pdiIdExtractSql, selectPdiIdFromJson } from "@/lib/pdi-tools/sync/pdi-id-sql";
import { mergeCalleeIdentityIndex, readCalleeIdentityIndex, type CalleeIdentityRecord } from "../bq-identity-index";
import { createdAtOnOrAfterSql } from "../snapshot-merge";
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
  filterPairsByQcDateRange,
  normalizeRecontactPersonId,
  pairIsUsefulRecontact,
  pairWithSupportAnswers,
  qcCallHasRecordedResponse,
  resolvePhonebankPriors,
  withRecontactCallDefaults,
  type QcRecontactDetailPayload,
  type QcRecontactPair,
  type QcRecontactSurveyAnswer,
  type RecontactCallSummary,
} from "../qc-recontact";
import { extractCalleeIdentity } from "../qc-recontact/identity";
import { mergeCanvassPriorsIntoPairs, replaceCanvassPriorsFromKnockIndex } from "../qc-recontact/canvass";
import { mergeTextPriorsIntoPairs } from "../qc-recontact/text";
import { fetchTagCallSurveyRowsForFinalFill } from "./phonebanking";
import { fetchTagTextContacts, fetchTextConversation } from "./text-recontact";
import { toStr, toDateString } from "./bq-row-parsers";
import type { CallSurveyRowForFill, CampaignTag, SurveyScriptProfile } from "../types";

const P = PROJECT;
const D = DATASET;
const PHONEBANK_WINDOW_START_DATE = "2025-12-01";

/** PDI keys first, then `v1_primaryid` / `primary_id` when the value is `CA` + digits. */
const CALLEE_PDI_ID_SQL = pdiIdExtractSql("callees.data");

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
  voterName: string;
  voterAddress: string;
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
      pdiId: list.find((row) => row.pdiId.trim())?.pdiId ?? first.pdiId,
      voterName: list.find((row) => row.voterName.trim())?.voterName ?? first.voterName,
      voterAddress: list.find((row) => row.voterAddress.trim())?.voterAddress ?? first.voterAddress,
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
  const byCall = new Map<string, CallSurveyRowForFill[]>();
  for (const row of fillRows) {
    const list = byCall.get(row.callId) ?? [];
    list.push(row);
    byCall.set(row.callId, list);
  }
  return pairs.map((pair) => {
    const rows = byCall.get(pair.qc.callId) ?? [];
    const qc = fillMissingCanvassLabel(withRecontactCallDefaults(pair.qc), rows, profile, terms);
    return qc === pair.qc ? pair : { ...pair, qc };
  });
}

const CALLEE_ID_CHUNK = 400;
const CALLEE_ID_PATTERN = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Numeric ids and Scale to Win callee UUIDs. Anything else is not put into SQL. */
export function isLookupCalleeId(id: string): boolean {
  return CALLEE_ID_PATTERN.test(id.trim());
}

export function calleeIdSqlLiteral(id: string): string {
  const value = id.trim();
  if (!isLookupCalleeId(value)) throw new Error("Unsafe callee id");
  if (/^\d+$/.test(value)) return value;
  return `'${value.toLowerCase()}'`;
}

type SurveyRowWithCallee = PdiSurveyRow & { calleeId: string };

/** Saved callee identity is finished when a lookup has already stored the PDI id, name, and address. */
export function calleeIdentityIsComplete(record: CalleeIdentityRecord | undefined): boolean {
  if (!record?.pdiId || !record.voterName) return false;
  return Boolean(record.voterAddress) || record.addressChecked === true;
}

/** Fill blank PDI id, name, and address on a dialer row from a saved callee record. */
export function applySavedCalleeIdentity<T extends CallSurveyRowForFill>(
  row: T,
  record: CalleeIdentityRecord | undefined
): T {
  const calleeId = row.calleeId?.trim() ?? "";
  if (!calleeId || !record) return row;
  const pdiId = row.pdiId?.trim() || normalizeRecontactPersonId(record.pdiId);
  const voterName = row.voterName?.trim() || record.voterName || "";
  const voterAddress = row.voterAddress?.trim() || record.voterAddress || "";
  if (pdiId === (row.pdiId ?? "") && voterName === (row.voterName ?? "") && voterAddress === (row.voterAddress ?? "")) {
    return row;
  }
  return { ...row, pdiId, voterName, voterAddress };
}

/**
 * Copy PDI id, name, and address from the local callee index onto dialer survey rows.
 * When `fetchMissing` is set, a callee the index has not finished is looked up once.
 * Page loads pass false so a QC table never starts its own warehouse scan.
 */
export async function stampFillIdentities(
  rows: readonly CallSurveyRowForFill[],
  fetchMissing: boolean
): Promise<CallSurveyRowForFill[]> {
  const index = readCalleeIdentityIndex().byCalleeId;
  const stamped = rows.map((row) => applySavedCalleeIdentity(row, index[row.calleeId?.trim() ?? ""]));
  if (!fetchMissing) return stamped;

  const pending: SurveyRowWithCallee[] = [];
  const seen = new Set<string>();
  for (const row of stamped) {
    const calleeId = row.calleeId?.trim() ?? "";
    if (!calleeId || seen.has(calleeId) || !isLookupCalleeId(calleeId)) continue;
    if (calleeIdentityIsComplete(index[calleeId])) continue;
    if (row.pdiId?.trim() && row.voterName?.trim() && row.voterAddress?.trim()) continue;
    seen.add(calleeId);
    pending.push({
      callId: row.callId,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      callDate: row.callDate,
      callAt: "",
      phonebankerName: row.phonebankerName,
      pdiId: row.pdiId?.trim() ?? "",
      voterName: row.voterName?.trim() ?? "",
      voterAddress: row.voterAddress?.trim() ?? "",
      questionName: row.questionName,
      answerValue: row.answerValue,
      calleeId,
    });
  }
  if (!pending.length) return stamped;
  await fillMissingCalleeIdentities(pending, index);
  const found = new Map(pending.map((row) => [row.calleeId, row]));
  return stamped.map((row) => {
    const match = found.get(row.calleeId?.trim() ?? "");
    if (!match) return row;
    return applySavedCalleeIdentity(row, {
      pdiId: match.pdiId,
      voterName: match.voterName,
      voterAddress: match.voterAddress,
      addressChecked: true,
    });
  });
}

/**
 * Read callee JSON only for this survey result's missing ids.
 * A partial write does not move the index watermark. The id list is the bound, so an older callee is still found.
 */
async function fillMissingCalleeIdentities(
  rows: SurveyRowWithCallee[],
  byCalleeId: Record<string, CalleeIdentityRecord>
): Promise<void> {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.calleeId;
    if (!isLookupCalleeId(id) || seen.has(id) || calleeIdentityIsComplete(byCalleeId[id])) continue;
    seen.add(id);
    missing.push(id);
  }
  if (missing.length === 0) return;

  const entries: Array<{ calleeId: string } & CalleeIdentityRecord> = [];
  for (let i = 0; i < missing.length; i += CALLEE_ID_CHUNK) {
    const chunk = missing.slice(i, i + CALLEE_ID_CHUNK);
    const sql = `
      SELECT
        CAST(id AS STRING) AS callee_id,
        COALESCE(data, '') AS callee_data
      FROM \`${P}.${D}.callees\`
      WHERE CAST(id AS STRING) IN (${chunk.map(calleeIdSqlLiteral).join(",")})
    `;
    const queried = await runQuery<Record<string, unknown>>(sql);
    for (const row of queried) {
      const identity = extractCalleeIdentity(toStr(row.callee_data));
      entries.push({
        calleeId: toStr(row.callee_id),
        pdiId: normalizeRecontactPersonId(selectPdiIdFromJson(toStr(row.callee_data))),
        voterName: identity.voterName,
        voterAddress: identity.voterAddress,
      });
    }
  }
  if (entries.length === 0) return;

  mergeCalleeIdentityIndex(entries, null);
  for (const entry of entries) {
    const prev = byCalleeId[entry.calleeId];
    byCalleeId[entry.calleeId] = {
      pdiId: prev?.pdiId || entry.pdiId || "",
      voterName: prev?.voterName || entry.voterName || "",
      voterAddress: prev?.voterAddress || entry.voterAddress || "",
      addressChecked: true,
    };
  }
  for (const row of rows) {
    const record = byCalleeId[row.calleeId];
    if (!record) continue;
    if (!row.pdiId) row.pdiId = normalizeRecontactPersonId(record.pdiId);
    if (!row.voterName) row.voterName = record.voterName;
    if (!row.voterAddress) row.voterAddress = record.voterAddress;
  }
}

export async function fetchTagPdiSurveyRows(
  tag: CampaignTag,
  options: { requirePdi: boolean; callDateOnOrAfter?: string; omitCalleeJson?: boolean; queryStartedAt?: string }
): Promise<PdiSurveyRow[]> {
  const whereClause = buildTagWhereClause(tag);
  const historyStart = /^\d{4}-\d{2}-\d{2}$/.test(options.callDateOnOrAfter ?? "")
    ? options.callDateOnOrAfter!
    : PHONEBANK_WINDOW_START_DATE;
  const omitJson = options.omitCalleeJson === true;
  const requirePdiSql = !omitJson && options.requirePdi ? `AND TRIM(${CALLEE_PDI_ID_SQL}) != ""` : "";
  const identitySql = omitJson
    ? `CAST(calls.callee_id AS STRING) AS callee_id`
    : `CAST(calls.callee_id AS STRING) AS callee_id,
      ${CALLEE_PDI_ID_SQL} AS pdi_id,
      COALESCE(callees.data, '') AS callee_data`;
  const calleeJoin = omitJson
    ? ""
    : `JOIN \`${P}.${D}.callees\` callees
      ON calls.callee_id = callees.id`;

  const rangeSql = omitJson
    ? `
      AND ${createdAtOnOrAfterSql("calls.created_at", historyStart)}
      AND (
        calls.connected_at IS NULL
        OR ${createdAtOnOrAfterSql("calls.connected_at", historyStart)}
      )`
    : "";

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
      ${identitySql},
      COALESCE(survey.question_name, '') AS question_name,
      TRIM(COALESCE(survey.answer_value, '')) AS answer_value
    FROM \`${P}.${D}.survey_results\` survey
    JOIN \`${P}.${D}.calls\` calls
      ON survey.call_id = calls.id
    ${calleeJoin}
    JOIN \`${P}.${D}.callers\` callers
      ON calls.caller_id = callers.id
    JOIN \`${P}.${D}.campaigns\` campaigns
      ON calls.campaign_id = campaigns.id
    WHERE ${whereClause}
      AND DATE(COALESCE(calls.connected_at, calls.created_at), 'America/Los_Angeles') >= '${historyStart}'
      ${rangeSql}
      AND survey.deleted_at IS NULL
      AND survey.question_name IS NOT NULL
      ${requirePdiSql}
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);
  const identityIndex = omitJson ? readCalleeIdentityIndex() : null;
  const mapped = rows.map((r) => {
    const calleeId = toStr(r.callee_id);
    const fromJson = omitJson ? null : extractCalleeIdentity(toStr(r.callee_data));
    const fromIndex = identityIndex?.byCalleeId[calleeId];
    const pdiId = omitJson
      ? normalizeRecontactPersonId(fromIndex?.pdiId ?? "")
      : normalizeRecontactPersonId(toStr(r.pdi_id));
    return {
      calleeId,
      callId: toStr(r.call_id),
      campaignId: toStr(r.campaign_id),
      campaignName: toStr(r.campaign_name),
      callDate: toDateString(r.call_date) ?? "",
      callAt: toStr(r.call_at),
      phonebankerName: canonicalizePhonebankerName(toStr(r.phonebanker_name)),
      pdiId,
      voterName: (omitJson ? fromIndex?.voterName : fromJson?.voterName) ?? "",
      voterAddress: (omitJson ? fromIndex?.voterAddress : fromJson?.voterAddress) ?? "",
      questionName: toStr(r.question_name),
      answerValue: toStr(r.answer_value),
    };
  });

  if (identityIndex) {
    await fillMissingCalleeIdentities(mapped, identityIndex.byCalleeId);
  }

  if (!omitJson && options.queryStartedAt) {
    mergeCalleeIdentityIndex(
      mapped.map((row) => ({
        calleeId: row.calleeId,
        pdiId: row.pdiId,
        voterName: row.voterName,
        voterAddress: row.voterAddress,
      })),
      options.queryStartedAt
    );
  }

  return mapped
    .filter((row) => (!omitJson && options.requirePdi ? row.pdiId !== "" : true))
    .map(({ calleeId: _calleeId, ...row }) => row);
}

export function buildQcRecontactPairsFromSources(
  qcTagId: string,
  qcRows: readonly PdiSurveyRow[],
  primaryRows: readonly PdiSurveyRow[],
  textContacts: Awaited<ReturnType<typeof fetchTagTextContacts>>
): QcRecontactPair[] {
  const qcTag = getTagById(qcTagId);
  if (!qcTag || !isDerivedQcTagId(qcTagId)) return [];

  const primaryId = primaryTagIdFromQc(qcTagId);
  const primaryTag = getTagById(primaryId);
  if (!primaryTag) return [];

  const profile = resolveSurveyScriptProfile(qcTag);
  const terms = candidateTermsForTag(primaryTag);
  const qcCalls = groupRowsIntoCallSummaries(qcRows, profile, terms).filter(
    (qc) => canvassResultIsTalkingToCorrectPerson(qc.canvassLabel) && qcCallHasRecordedResponse(qc, profile)
  );
  const phonePairs = resolvePhonebankPriors(
    qcCalls,
    groupRowsIntoCallSummaries(primaryRows, profile, terms),
    profile
  );
  const knocks = loadKnockIndexRows();
  const withCanvass = mergeCanvassPriorsIntoPairs(phonePairs, primaryTag, knocks, profile);
  const withText = mergeTextPriorsIntoPairs(withCanvass, primaryTag, textContacts, profile);
  return replaceCanvassPriorsFromKnockIndex(withText, primaryTag, knocks, profile);
}

export async function buildQcRecontactPairsFromBigQuery(qcTagId: string): Promise<QcRecontactPair[]> {
  const qcTag = getTagById(qcTagId);
  if (!qcTag || !isDerivedQcTagId(qcTagId)) return [];
  const primaryTag = getTagById(primaryTagIdFromQc(qcTagId));
  if (!primaryTag) return [];
  const profile = resolveSurveyScriptProfile(qcTag);
  const [qcRows, primaryRows, textContacts] = await Promise.all([
    fetchTagPdiSurveyRows(qcTag, { requirePdi: false }),
    fetchTagPdiSurveyRows(primaryTag, { requirePdi: true }),
    fetchTagTextContacts(primaryTag, profile),
  ]);
  return buildQcRecontactPairsFromSources(qcTagId, qcRows, primaryRows, textContacts);
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

  const { buildQcRecontactPairsFromLocalFiles } = await import("../qc-recontact/local-pairs");
  const localPairs = await buildQcRecontactPairsFromLocalFiles(tagId);
  if (localPairs) {
    return { pairs: localPairs, hasSnapshot: true };
  }

  const snap = loadRecontactPairsSnapshot(tagId);
  if (!snap) return { pairs: [], hasSnapshot: false };
  const fillRows = loadCallSurveyFillSnapshot(tagId)?.rows ?? [];
  const hydrated = hydrateRecontactPairsFromSurveyFill(snap.pairs, fillRows, profile, terms);
  return {
    pairs: replaceCanvassPriorsFromKnockIndex(hydrated, primaryTag, loadKnockIndexRows(), profile),
    hasSnapshot: true,
  };
}

/** Per-request memo so the header tile and the table share one knock-index pass. */
export const loadQcRecontactPairsForPageCached = cache(loadQcRecontactPairsForPage);

/**
 * Same date and support filters the QC page applied before rendering the table.
 */
export function prepareQcRecontactPagePairs(
  pairs: readonly QcRecontactPair[],
  startDate: string,
  endDate: string,
  profile: SurveyScriptProfile
): QcRecontactPair[] {
  return filterPairsByQcDateRange(pairs, startDate, endDate)
    .filter((pair) => pairIsUsefulRecontact(pair, profile))
    .map((pair) => pairWithSupportAnswers(pair, profile));
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
  const pair = loaded.pairs.find((row) => {
    if (row.qc.callId !== qcCallId) return false;
    if (!wantPdi || wantPdi === "NONE") return true;
    return normalizeRecontactPersonId(row.qc.pdiId) === wantPdi;
  });
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
