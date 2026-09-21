import type { SurveyResultRow } from "./types";

function norm(x: unknown): string {
  if (x === null || x === undefined) return "";
  return String(x).trim();
}

function callTimeMs(callTime: SurveyResultRow["call_time"]): number {
  if (!callTime) return Number.NEGATIVE_INFINITY;
  const valStr =
    typeof callTime === "object" && callTime !== null && "value" in callTime
      ? String(callTime.value ?? "").trim()
      : String(callTime).trim();
  if (!valStr) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(valStr.replace(" ", "T"));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function statusGroupKey(row: SurveyResultRow): string {
  return `${norm(row.campaign_name)}\0${norm(row.pdi_id)}\0${norm(row.question_name)}`;
}

/**
 * Phonebank analog of one Final Result per call: keep the latest Support (or
 * Moved) tag per person in a campaign. Earlier conflicting statuses are dropped
 * so the same PDI ID cannot receive both SS and U from one list.
 */
export function collapseTextRowsToLatestStatus(rows: SurveyResultRow[]): {
  rows: SurveyResultRow[];
  collapsedCount: number;
} {
  const winnerByKey = new Map<string, { index: number; ms: number }>();

  rows.forEach((row, index) => {
    const key = statusGroupKey(row);
    const ms = callTimeMs(row.call_time);
    const current = winnerByKey.get(key);
    if (!current || ms > current.ms || (ms === current.ms && index > current.index)) {
      winnerByKey.set(key, { index, ms });
    }
  });

  const winnerIndexes = new Set([...winnerByKey.values()].map((winner) => winner.index));
  const kept = rows.filter((_, index) => winnerIndexes.has(index));
  return { rows: kept, collapsedCount: rows.length - kept.length };
}
