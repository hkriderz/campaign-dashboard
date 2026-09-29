import { canonicalizePhonebankerName } from "./phonebanker-name";
import type { CallSurveyRowForFill, PhonebankerQuestionResponseStat } from "./types";

const NO_ANSWER = "[No Answer Recorded]";

function sortQuestionStats(
  a: PhonebankerQuestionResponseStat,
  b: PhonebankerQuestionResponseStat
): number {
  if (a.callDate !== b.callDate) return b.callDate.localeCompare(a.callDate);
  if (a.campaignName !== b.campaignName) return a.campaignName.localeCompare(b.campaignName);
  if (a.phonebankerName !== b.phonebankerName) return a.phonebankerName.localeCompare(b.phonebankerName);
  if (a.questionName !== b.questionName) return a.questionName.localeCompare(b.questionName);
  return a.answerValue.localeCompare(b.answerValue);
}

/**
 * Same grain as the former question-stats SQL:
 * COUNT(DISTINCT call_id) by campaign, date, phonebanker, question, and answer.
 * A blank answer is stored as `[No Answer Recorded]`.
 */
export function questionStatsFromFillRows(
  rows: readonly CallSurveyRowForFill[]
): PhonebankerQuestionResponseStat[] {
  const callsByKey = new Map<string, Set<string>>();
  const statsByKey = new Map<string, PhonebankerQuestionResponseStat>();

  for (const row of rows) {
    const phonebankerName = canonicalizePhonebankerName(row.phonebankerName);
    const answerValue = row.answerValue.trim() ? row.answerValue.trim() : NO_ANSWER;
    const questionName = row.questionName;
    const key = `${row.campaignId}::${row.callDate}::${phonebankerName}::${questionName}::${answerValue}`;
    let calls = callsByKey.get(key);
    if (!calls) {
      calls = new Set<string>();
      callsByKey.set(key, calls);
      statsByKey.set(key, {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        callDate: row.callDate,
        phonebankerName,
        questionName,
        answerValue,
        responseCount: 0,
      });
    }
    if (row.callId) calls.add(row.callId);
  }

  const stats: PhonebankerQuestionResponseStat[] = [];
  for (const [key, stat] of statsByKey) {
    stats.push({ ...stat, responseCount: callsByKey.get(key)?.size ?? 0 });
  }
  return stats.sort(sortQuestionStats);
}
