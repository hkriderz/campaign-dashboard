import { makeSliceKey } from "./slice-key";
import { isTraciViolationQuestionName, normalizeSurveyTextForMatching } from "./survey-i18n/rules";
import type { PhonebankerQuestionResponseStat } from "./types";

/** Matches Traci violations script block in STW (shared with dashboard pivot logic). */
export function isTraciViolationQuestion(questionName: string): boolean {
  return isTraciViolationQuestionName(questionName);
}

/**
 * Map BQ answer text to Yes / Unsure / No buckets for the daily aggregate (CSV parity).
 * Lettered options A/B/C are a fallback when wording varies by campaign.
 *
 * Order matters: "No / shouldn't disqualify / doesn't bother" answers still contain the
 * substring "disqualif" (in "disqualify") — those must be classified as No before any broad
 * "disqualif" → Yes heuristic runs.
 */
export function classifyTraciViolationAnswer(answerValue: string): "yes" | "unsure" | "no" {
  const raw = answerValue.trim();
  const a = raw.toLowerCase();
  if (!a || a === "[no answer recorded]") return "unsure";

  const norm = normalizeSurveyTextForMatching(a);

  // --- No (should not disqualify / doesn't bother) — before any generic "disqualif" check
  if (
    /doesn\s*'?t bother|does not bother/.test(norm) ||
    /no\s+should\s+not\s+disqualif/.test(norm) ||
    /\bno,?\s*doesn/.test(norm) ||
    /shouldn['']?t\s+disqualif/i.test(norm) ||
    /not\s+disqualif/i.test(norm) ||
    /n['']?t\s+disqualif/i.test(norm)
  ) {
    return "no";
  }

  if (/\bunsure\b|\bnot sure\b|no\s+seguro/i.test(norm)) return "unsure";

  const lead = raw.match(/^\s*([A-Ca-c])[\.\)\-:\s]/);
  if (lead) {
    const L = lead[1]!.toUpperCase();
    if (L === "A") return "yes";
    if (L === "B") return "unsure";
    if (L === "C") return "no";
  }

  // --- Yes: explicit positive, or "disqualify" in a pro-disqualify sense only
  if (/\byes\s+should\s+disqualify/i.test(norm)) return "yes";
  if (/\bdisqualif/i.test(norm)) return "yes";

  if (/\byes\b/.test(norm) && !/\bno\b/.test(norm)) return "yes";
  if (/\bno\b/.test(norm)) return "no";
  return "unsure";
}

type SliceTraciRollup = {
  traciYes: number;
  traciUnsure: number;
  traciNo: number;
  traciSurveyed: number;
  campaignName: string;
  callDate: string;
};

/**
 * Add Traci violation counts from BigQuery question stats into per-slice rollups.
 * Recomputes traciSurveyed as the sum of yes + unsure + no so CSV + BQ stay consistent.
 */
export function mergeTraciViolationStatsFromBq(
  rows: PhonebankerQuestionResponseStat[],
  sliceMap: Map<string, SliceTraciRollup>
): void {
  for (const row of rows) {
    if (!isTraciViolationQuestion(row.questionName)) continue;
    const sk = makeSliceKey(row.campaignName, row.callDate);
    const agg = sliceMap.get(sk);
    if (!agg) continue;
    const n = row.responseCount;
    if (n <= 0) continue;
    const b = classifyTraciViolationAnswer(row.answerValue);
    if (b === "yes") agg.traciYes += n;
    else if (b === "no") agg.traciNo += n;
    else agg.traciUnsure += n;
  }

  for (const agg of sliceMap.values()) {
    agg.traciSurveyed = agg.traciYes + agg.traciUnsure + agg.traciNo;
  }
}
