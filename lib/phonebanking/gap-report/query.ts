import "server-only";

import { DateTime } from "luxon";
import { DATASET, PROJECT, runQuery } from "@/lib/bigquery";
import { assertDataAccessAllowed } from "@/lib/credentials/gate";
import { buildTagWhereClause, getTagById } from "@/lib/campaign-tags";
import { canonicalizePhonebankerName } from "@/lib/phonebanker-name";
import { toNum, toStr } from "@/lib/queries/bq-row-parsers";
import {
  isValidPhonebankingIsoDate,
} from "@/lib/queries/phonebanking";
import { paddedCreatedAtRangeSql } from "@/lib/snapshot-merge";
import {
  SCRIPT_BLOCK_EXCLUSION_REGEX_BODY,
  TRACI_SCRIPT_EXCLUSION_REGEX_BODY,
} from "@/lib/survey-i18n/rules";
import type { PhonebankCallEvent } from "./types";

const P = PROJECT;
const D = DATASET;
const LA = "America/Los_Angeles";
const PHONEBANK_WINDOW_START_DATE = "2025-12-01";

type CallsColumnSet = {
  ended_at: boolean;
  telephony_status: boolean;
  status: boolean;
};

let callsColumnsCache: CallsColumnSet | null = null;
let callsColumnsInFlight: Promise<CallsColumnSet> | null = null;

async function getCallsColumns(): Promise<CallsColumnSet> {
  if (callsColumnsCache) return callsColumnsCache;
  if (!callsColumnsInFlight) {
    callsColumnsInFlight = runQuery<Record<string, unknown>>(`
      SELECT column_name
      FROM \`${P}.${D}.INFORMATION_SCHEMA.COLUMNS\`
      WHERE table_name = 'calls'
    `)
      .then((rows) => {
        const set = new Set(rows.map((r) => toStr(r.column_name).toLowerCase()));
        callsColumnsCache = {
          ended_at: set.has("ended_at"),
          telephony_status: set.has("telephony_status"),
          status: set.has("status"),
        };
        return callsColumnsCache;
      })
      .finally(() => {
        callsColumnsInFlight = null;
      });
  }
  return callsColumnsInFlight;
}

function pacificIsoFromDatetimeString(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // BigQuery DATETIME strings arrive as "YYYY-MM-DD HH:MM:SS" or ISO-ish.
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const dt = DateTime.fromISO(normalized, { zone: LA });
  if (dt.isValid) return dt.toISO();
  const fallback = DateTime.fromSQL(trimmed, { zone: LA });
  return fallback.isValid ? fallback.toISO() : null;
}

/**
 * Call-level rows for one Pacific calendar day of `calls.created_at`.
 * End = `ended_at` when present, else `connected_at + duration`, else dial time (no-connect).
 */
export async function fetchPhonebankGapCallsForDay(options: {
  workDate: string;
  tagId?: string | null;
}): Promise<PhonebankCallEvent[]> {
  assertDataAccessAllowed({ gcp: true });

  const workDate = options.workDate.trim();
  if (!isValidPhonebankingIsoDate(workDate)) {
    throw new Error("Invalid work date. Use YYYY-MM-DD.");
  }
  if (workDate < PHONEBANK_WINDOW_START_DATE) {
    throw new Error(`Work date must be on or after ${PHONEBANK_WINDOW_START_DATE}.`);
  }

  const tagId = options.tagId?.trim() || "";
  let whereClause = "TRUE";
  if (tagId) {
    const tag = getTagById(tagId);
    if (!tag) throw new Error(`Unknown campaign tag: ${tagId}`);
    whereClause = buildTagWhereClause(tag);
  }

  const cols = await getCallsColumns();
  const telephonySelect = cols.telephony_status
    ? `CAST(calls.telephony_status AS STRING)`
    : cols.status
      ? `CAST(calls.status AS STRING)`
      : `CAST(NULL AS STRING)`;

  const endedAtExpr = cols.ended_at
    ? `COALESCE(
        DATETIME(calls.ended_at, '${LA}'),
        IF(
          calls.connected_at IS NOT NULL,
          DATETIME(
            TIMESTAMP_ADD(
              calls.connected_at,
              INTERVAL CAST(COALESCE(calls.duration, 0) AS INT64) SECOND
            ),
            '${LA}'
          ),
          DATETIME(calls.created_at, '${LA}')
        )
      )`
    : `IF(
        calls.connected_at IS NOT NULL,
        DATETIME(
          TIMESTAMP_ADD(
            calls.connected_at,
            INTERVAL CAST(COALESCE(calls.duration, 0) AS INT64) SECOND
          ),
          '${LA}'
        ),
        DATETIME(calls.created_at, '${LA}')
      )`;

  const sql = `
    WITH call_rows AS (
      SELECT
        CAST(calls.id AS STRING) AS call_id,
        callers.name AS phonebanker_name,
        CAST(campaigns.id AS STRING) AS campaign_id,
        campaigns.name AS campaign_name,
        CAST(DATE(calls.created_at, '${LA}') AS STRING) AS work_date,
        DATETIME(calls.created_at, '${LA}') AS dialed_at,
        IF(
          calls.connected_at IS NOT NULL,
          DATETIME(calls.connected_at, '${LA}'),
          NULL
        ) AS connected_at,
        ${endedAtExpr} AS ended_at,
        CAST(COALESCE(calls.duration, 0) AS FLOAT64) AS duration_seconds,
        ${telephonySelect} AS telephony_status
      FROM \`${P}.${D}.calls\` AS calls
      JOIN \`${P}.${D}.callers\` AS callers
        ON calls.caller_id = callers.id
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON calls.campaign_id = campaigns.id
      WHERE ${whereClause}
        AND DATE(calls.created_at, '${LA}') = '${workDate}'
        AND ${paddedCreatedAtRangeSql("calls.created_at", workDate, workDate)}
    ),
    disposition_ranked AS (
      SELECT
        CAST(survey.call_id AS STRING) AS call_id,
        TRIM(COALESCE(survey.answer_value, '')) AS answer_value,
        COALESCE(TRIM(survey.question_name), '') AS question_name,
        ROW_NUMBER() OVER (
          PARTITION BY survey.call_id
          ORDER BY survey.id ASC
        ) AS rn
      FROM \`${P}.${D}.survey_results\` AS survey
      JOIN call_rows ON CAST(survey.call_id AS STRING) = call_rows.call_id
      WHERE survey.deleted_at IS NULL
        AND survey.question_name IS NOT NULL
        AND NOT REGEXP_CONTAINS(
          LOWER(survey.question_name),
          r'${SCRIPT_BLOCK_EXCLUSION_REGEX_BODY}'
        )
        AND NOT REGEXP_CONTAINS(
          LOWER(survey.question_name),
          r'${TRACI_SCRIPT_EXCLUSION_REGEX_BODY}'
        )
        AND REGEXP_CONTAINS(
          LOWER(survey.question_name),
          r'(contact\\s*quality|canvass\\s*result|canvass\\s*disposition|call\\s*disposition|contact\\s*disposition)'
        )
        AND TRIM(COALESCE(survey.answer_value, '')) != ''
    )
    SELECT
      call_rows.call_id,
      call_rows.phonebanker_name,
      call_rows.campaign_id,
      call_rows.campaign_name,
      call_rows.work_date,
      FORMAT_DATETIME('%Y-%m-%dT%H:%M:%S', call_rows.dialed_at) AS dialed_at,
      IF(
        call_rows.connected_at IS NULL,
        NULL,
        FORMAT_DATETIME('%Y-%m-%dT%H:%M:%S', call_rows.connected_at)
      ) AS connected_at,
      FORMAT_DATETIME('%Y-%m-%dT%H:%M:%S', call_rows.ended_at) AS ended_at,
      call_rows.duration_seconds,
      COALESCE(disposition_ranked.answer_value, '') AS disposition,
      COALESCE(call_rows.telephony_status, '') AS telephony_status
    FROM call_rows
    LEFT JOIN disposition_ranked
      ON call_rows.call_id = disposition_ranked.call_id
      AND disposition_ranked.rn = 1
    ORDER BY call_rows.phonebanker_name, call_rows.dialed_at, call_rows.call_id
  `;

  const rows = await runQuery<Record<string, unknown>>(sql, {
    label: "phonebank_gap_calls",
    mode: "gap_report",
  });

  return rows.map((r) => {
    const dialedRaw = toStr(r.dialed_at);
    const connectedRaw = toStr(r.connected_at);
    const endedRaw = toStr(r.ended_at);
    const dialedAt = pacificIsoFromDatetimeString(dialedRaw) ?? `${workDate}T00:00:00.000-08:00`;
    const connectedAt = connectedRaw ? pacificIsoFromDatetimeString(connectedRaw) : null;
    const endedAt =
      pacificIsoFromDatetimeString(endedRaw) ??
      connectedAt ??
      dialedAt;
    const durationSeconds = Math.max(0, toNum(r.duration_seconds));

    return {
      callId: toStr(r.call_id),
      phonebankerName: canonicalizePhonebankerName(toStr(r.phonebanker_name)),
      campaignId: toStr(r.campaign_id),
      campaignName: toStr(r.campaign_name),
      workDate: toStr(r.work_date) || workDate,
      dialedAt,
      connectedAt,
      endedAt,
      durationSeconds,
      connected: Boolean(connectedAt),
      disposition: toStr(r.disposition),
      telephonyStatus: toStr(r.telephony_status),
    } satisfies PhonebankCallEvent;
  });
}
