import test from "node:test";
import assert from "node:assert/strict";
import { buildPhonebankerBqOutcomeMap } from "./phonebanker-bq-outcomes";
import type { PhonebankerQuestionResponseStat } from "./types";

function stat(
  partial: Pick<PhonebankerQuestionResponseStat, "questionName" | "answerValue" | "responseCount">
): PhonebankerQuestionResponseStat {
  return {
    campaignId: "1",
    campaignName: "Test Bank",
    callDate: "2026-09-01",
    phonebankerName: "Jane Doe",
    ...partial,
  };
}

test("split-column Strong Support + Yes increments finalSS", () => {
  const map = buildPhonebankerBqOutcomeMap([
    stat({
      questionName: "Final Result - Strong Support",
      answerValue: "Yes",
      responseCount: 4,
    }),
  ]);
  const acc = [...map.values()][0];
  assert.equal(acc?.finalSS, 4);
  assert.equal(acc?.finalUndecided, 0);
});

test("Yes on generic Final Result does not increment finalSS", () => {
  const map = buildPhonebankerBqOutcomeMap([
    stat({
      questionName: "Final Result",
      answerValue: "Yes",
      responseCount: 3,
    }),
  ]);
  const acc = [...map.values()][0];
  assert.equal(acc?.finalSS, 0);
});
