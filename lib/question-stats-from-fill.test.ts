import assert from "node:assert/strict";
import test from "node:test";
import { questionStatsFromFillRows } from "./question-stats-from-fill";
import type { CallSurveyRowForFill } from "./types";

function row(partial: Partial<CallSurveyRowForFill> & Pick<CallSurveyRowForFill, "callId">): CallSurveyRowForFill {
  return {
    callId: partial.callId,
    campaignId: partial.campaignId ?? "c1",
    campaignName: partial.campaignName ?? "Faizah",
    callDate: partial.callDate ?? "2026-09-01",
    phonebankerName: partial.phonebankerName ?? "Ada",
    questionName: partial.questionName ?? "Final Result",
    answerValue: partial.answerValue ?? "A. Yes",
    surveyResultId: partial.surveyResultId ?? 1,
  };
}

test("question stats count distinct calls and label blank answers", () => {
  const stats = questionStatsFromFillRows([
    row({ callId: "1", answerValue: "A. Yes", surveyResultId: 1 }),
    row({ callId: "1", answerValue: "A. Yes", surveyResultId: 2 }),
    row({ callId: "2", answerValue: "  ", surveyResultId: 3 }),
    row({ callId: "3", answerValue: "", surveyResultId: 4 }),
  ]);
  const yes = stats.find((stat) => stat.answerValue === "A. Yes");
  const blank = stats.find((stat) => stat.answerValue === "[No Answer Recorded]");
  assert.equal(yes?.responseCount, 1);
  assert.equal(blank?.responseCount, 2);
});
