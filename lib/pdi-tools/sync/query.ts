import { STW_DATASET, STW_PROJECT } from "./constants";
import { pdiIdExtractSql } from "./pdi-id-sql";

/**
 * Dialer survey rows for a sync window.
 * Each flag is dated from its own call: Pacific time of connected_at, or
 * created_at when the call never connected. The campaign is that call's
 * campaign, so an earlier contact on the same PDI cannot supply the date.
 */
export function buildSurveyQuery(startIso: string, endIso: string): string {
  const startStr = startIso.slice(0, 19).replace("T", " ");
  const endStr = endIso.slice(0, 19).replace("T", " ");

  return `
    WITH base AS (
      SELECT
        callees.id AS callee_id,
        DATETIME(
          COALESCE(calls.connected_at, calls.created_at),
          'America/Los_Angeles'
        ) AS call_time,
        SAFE.PARSE_JSON(callees.data) AS new_data,
        calls.id AS call_id,
        ${pdiIdExtractSql("callees.data")} AS pdi_id,
        callers.id AS caller_id,
        callers.name AS phonebanker,
        campaigns.name AS campaign_name,
        survey.question_name,
        survey.answer_value
      FROM \`${STW_PROJECT}.${STW_DATASET}.survey_results\` AS survey
      JOIN \`${STW_PROJECT}.${STW_DATASET}.calls\` AS calls
        ON survey.call_id = calls.id
      JOIN \`${STW_PROJECT}.${STW_DATASET}.callees\` AS callees
        ON calls.callee_id = callees.id
      JOIN \`${STW_PROJECT}.${STW_DATASET}.callers\` AS callers
        ON calls.caller_id = callers.id
      JOIN \`${STW_PROJECT}.${STW_DATASET}.campaigns\` AS campaigns
        ON calls.campaign_id = campaigns.id
      WHERE survey.deleted_at IS NULL
        AND survey.question_name IS NOT NULL
    )
    SELECT *
    FROM base
    WHERE
      call_time >= '${startStr}'
      AND call_time < '${endStr}'
      AND TRIM(pdi_id) != ""
  `.trim();
}
