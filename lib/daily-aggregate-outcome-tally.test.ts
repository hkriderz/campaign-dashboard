import test from "node:test";
import assert from "node:assert/strict";
import { makeBqSliceKey } from "./slice-key";
import { tallySupportOutcomesByCampaign } from "./daily-aggregate-outcome-tally";

const nithyaTerms = ["nithya", "raman"];
const date = "2026-09-12";
const regularId = "regular-nithya";
const qcId = "qc-nithya";

function sliceKeys() {
  return new Set([makeBqSliceKey(regularId, "Nithya PB", date), makeBqSliceKey(qcId, "Nithya QC PB", date)]);
}

test("Nithya ID-only bank is counted even when QC has Final Result", () => {
  const tally = tallySupportOutcomesByCampaign(
    [
      {
        campaignId: regularId,
        campaignName: "Nithya PB",
        callDate: date,
        questionName: "1. Can we count on your vote for Nithya Raman for Mayor?",
        answerValue: "A. Strong Support for Nithya",
        responseCount: 10,
      },
      {
        campaignId: regularId,
        campaignName: "Nithya PB",
        callDate: date,
        questionName: "1. Can we count on your vote for Nithya Raman for Mayor?",
        answerValue: "B. Undecided",
        responseCount: 3,
      },
      {
        campaignId: regularId,
        campaignName: "Nithya PB",
        callDate: date,
        questionName: "1. Can we count on your vote for Nithya Raman for Mayor?",
        answerValue: "C. Strong Oppose",
        responseCount: 2,
      },
      {
        campaignId: qcId,
        campaignName: "Nithya QC PB",
        callDate: date,
        questionName: "4. Final Result",
        answerValue: "Strong Support for Nithya",
        responseCount: 5,
      },
      {
        campaignId: qcId,
        campaignName: "Nithya QC PB",
        callDate: date,
        questionName: "4. Final Result",
        answerValue: "Undecided",
        responseCount: 1,
      },
      {
        campaignId: qcId,
        campaignName: "Nithya QC PB",
        callDate: date,
        questionName: "2. Polling",
        answerValue: "Strong Support for Nithya",
        responseCount: 8,
      },
    ],
    { sliceKeys: sliceKeys(), profile: "faizahTraci", terms: nithyaTerms }
  );

  assert.equal(tally.strongSupport, 15);
  assert.equal(tally.undecided, 4);
  assert.equal(tally.strongOppose, 2);
});

test("candidate-page slice keys omit QC Final Result", () => {
  const tally = tallySupportOutcomesByCampaign(
    [
      {
        campaignId: regularId,
        campaignName: "Nithya PB",
        callDate: date,
        questionName: "1. Can we count on your vote for Nithya Raman for Mayor?",
        answerValue: "A. Strong Support for Nithya",
        responseCount: 10,
      },
      {
        campaignId: qcId,
        campaignName: "Nithya QC PB",
        callDate: date,
        questionName: "4. Final Result",
        answerValue: "Strong Support for Nithya",
        responseCount: 5,
      },
    ],
    {
      sliceKeys: new Set([makeBqSliceKey(regularId, "Nithya PB", date)]),
      profile: "faizahTraci",
      terms: nithyaTerms,
    }
  );
  assert.equal(tally.strongSupport, 10);
  assert.equal(tally.undecided, 0);
  assert.equal(tally.strongOppose, 0);
});

test("campaign with Final Result does not also add its polling question", () => {
  const tally = tallySupportOutcomesByCampaign(
    [
      {
        campaignId: qcId,
        campaignName: "Nithya QC PB",
        callDate: date,
        questionName: "4. Final Result",
        answerValue: "Strong Support for Nithya",
        responseCount: 5,
      },
      {
        campaignId: qcId,
        campaignName: "Nithya QC PB",
        callDate: date,
        questionName: "2. Polling",
        answerValue: "Strong Support for Nithya",
        responseCount: 8,
      },
    ],
    {
      sliceKeys: new Set([makeBqSliceKey(qcId, "Nithya QC PB", date)]),
      profile: "faizahTraci",
      terms: nithyaTerms,
    }
  );

  assert.equal(tally.strongSupport, 5);
  assert.equal(tally.undecided, 0);
  assert.equal(tally.strongOppose, 0);
});
