import assert from "node:assert/strict";
import test from "node:test";
import { makeBqSliceKey } from "./slice-key";
import { rollupPollingAndFinalAnswers } from "./daily-aggregate-survey-rollup";
import type { PhonebankerQuestionResponseStat } from "./types";

const date = "2026-10-17";
const nithyaTerms = ["nithya", "raman"];

function row(
  partial: Partial<PhonebankerQuestionResponseStat> &
    Pick<PhonebankerQuestionResponseStat, "campaignId" | "campaignName" | "questionName" | "answerValue" | "responseCount">
): PhonebankerQuestionResponseStat {
  return {
    callDate: date,
    phonebankerName: "Ava",
    ...partial,
  };
}

test("polling preset uses Polling answers when present", () => {
  const campaignId = "pb-1";
  const keys = new Set([makeBqSliceKey(campaignId, "Nithya PB", date)]);
  const { polling, finalResult } = rollupPollingAndFinalAnswers(
    [
      row({
        campaignId,
        campaignName: "Nithya PB",
        questionName: "02 Polling",
        answerValue: "Support Nithya",
        responseCount: 4,
      }),
      row({
        campaignId,
        campaignName: "Nithya PB",
        questionName: "1. Can we count on your vote for Nithya Raman for Mayor?",
        answerValue: "A. Strong Support for Nithya",
        responseCount: 9,
      }),
      row({
        campaignId,
        campaignName: "Nithya PB",
        questionName: "4. Final Result",
        answerValue: "Strong Support for Nithya",
        responseCount: 2,
      }),
    ],
    {
      sliceKeys: keys,
      dateFilter: null,
      surveyScriptProfile: "faizahTraci",
      candidateTerms: nithyaTerms,
    }
  );
  assert.equal(polling.reduce((s, l) => s + l.count, 0), 4);
  assert.ok(polling.some((l) => l.label === "Support Nithya"));
  assert.equal(finalResult.reduce((s, l) => s + l.count, 0), 2);
});

test("polling preset falls back to candidate ID asks when no Polling block", () => {
  const campaignId = "pb-2";
  const keys = new Set([makeBqSliceKey(campaignId, "Nithya PB", date)]);
  const { polling } = rollupPollingAndFinalAnswers(
    [
      row({
        campaignId,
        campaignName: "Nithya PB",
        questionName: "1. Can we count on your vote for Nithya Raman for Mayor?",
        answerValue: "A. Strong Support for Nithya",
        responseCount: 7,
      }),
      row({
        campaignId,
        campaignName: "Nithya PB",
        questionName: "4. Final Result",
        answerValue: "Undecided",
        responseCount: 1,
      }),
    ],
    {
      sliceKeys: keys,
      dateFilter: null,
      surveyScriptProfile: "faizahTraci",
      candidateTerms: nithyaTerms,
    }
  );
  assert.equal(polling.length, 1);
  assert.equal(polling[0]?.count, 7);
  assert.match(polling[0]?.label ?? "", /Strong Support/i);
});
