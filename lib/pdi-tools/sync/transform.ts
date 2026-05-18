import { ACQUISITION_TYPE_ID } from "./constants";
import { ledgerKey } from "./ledger";
import { getFlag, getQuestionId, type MappingMaps } from "./mapping";
import type { PdiFlagPayloadItem, SurveyResultRow } from "./types";

function norm(x: unknown): string {
  if (x === null || x === undefined) return "";
  return String(x).trim();
}

export function extractFlagDate(callTimeVal: unknown): string {
  if (!callTimeVal) return new Date().toISOString().slice(0, 10);

  let valStr: string;
  if (typeof callTimeVal === "object" && callTimeVal !== null && "value" in callTimeVal) {
    valStr = String((callTimeVal as { value: string }).value).trim();
  } else {
    valStr = String(callTimeVal).trim();
  }

  const parsed = Date.parse(valStr.replace(" ", "T"));
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  if (valStr.length >= 10) {
    const datePart = valStr.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  }

  return new Date().toISOString().slice(0, 10);
}

export type TransformResult = {
  payload: PdiFlagPayloadItem[];
  rowsSkipped: number;
  rowsDeduped: number;
  rowsDedupedSameBatch: number;
};

export function transformSurveyRows(
  rows: SurveyResultRow[],
  maps: MappingMaps,
  ledger: Set<string>
): TransformResult {
  const payload: PdiFlagPayloadItem[] = [];
  let rowsSkipped = 0;
  let rowsDeduped = 0;
  let rowsDedupedSameBatch = 0;
  const queuedSyncKeys = new Set<string>();

  for (const r of rows) {
    const survey = norm(r.campaign_name);
    const question = norm(r.question_name);
    const answer = norm(r.answer_value);
    const pdiId = norm(r.pdi_id || r.callee_id || r.caller_id);

    if (!pdiId) {
      rowsSkipped += 1;
      continue;
    }

    const qid = getQuestionId(maps, survey, question);
    if (!qid) {
      rowsSkipped += 1;
      continue;
    }

    const flagId = getFlag(maps, survey, question, answer);
    if (!flagId) {
      rowsSkipped += 1;
      continue;
    }

    const flagDateStr = extractFlagDate(r.call_time);
    const flagCode = maps.flagIdToCode.get(flagId) ?? flagId;
    const key = ledgerKey(pdiId, flagCode, flagDateStr);

    if (ledger.has(key)) {
      rowsDeduped += 1;
      continue;
    }

    if (queuedSyncKeys.has(key)) {
      rowsDedupedSameBatch += 1;
      rowsDeduped += 1;
      continue;
    }

    queuedSyncKeys.add(key);
    payload.push({
      pdiId,
      questionId: qid,
      flagId,
      acquisitionTypeId: ACQUISITION_TYPE_ID,
      flagEntryDate: flagDateStr,
    });
  }

  return { payload, rowsSkipped, rowsDeduped, rowsDedupedSameBatch };
}