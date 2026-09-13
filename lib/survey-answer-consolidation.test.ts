import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERIC_OUTCOME_LABELS,
  csvAnswerForFinalResultFamily,
  isStrongSupportSurveyHit,
  sumFinalResultFamilies,
  synthesizedHitMatchesLabel,
} from "./survey-answer-consolidation";

test("combined Final Result + Strong Support answer counts as SS", () => {
  assert.equal(isStrongSupportSurveyHit("Final Result", "A. Strong Support"), true);
  assert.equal(isStrongSupportSurveyHit("Final Result", "Support Faizah"), true);
  assert.equal(isStrongSupportSurveyHit("Resultado final", "A. Strong Support"), true);
});

test("split Final Result - Strong Support + Yes counts as SS", () => {
  assert.equal(isStrongSupportSurveyHit("Final Result - Strong Support", "Yes"), true);
  assert.equal(isStrongSupportSurveyHit("Pitch - Strong Support", "Yes"), true);
  assert.equal(isStrongSupportSurveyHit("Final Result - Strong Support", "A"), true);
});

test("split Final Result - Strong Oppose + Yes does not count as SS", () => {
  assert.equal(isStrongSupportSurveyHit("Final Result - Strong Oppose", "Yes"), false);
  assert.equal(isStrongSupportSurveyHit("Final Result - Oppose", "Yes"), false);
});

test("Yes on a generic Final Result question does not count as SS", () => {
  assert.equal(isStrongSupportSurveyHit("Final Result", "Yes"), false);
  assert.equal(isStrongSupportSurveyHit("Final Result", "[No Answer Recorded]"), false);
});

test("Nithya support answers count as SS", () => {
  assert.equal(isStrongSupportSurveyHit("Final Result", "Support Nithya"), true);
  assert.equal(isStrongSupportSurveyHit("Final Result", "A. Support Nithya Raman"), true);
  assert.equal(isStrongSupportSurveyHit("03 Final Result", "Strong Support"), true);
});

test("Ada and Eunisses profiles map candidate support to SS", () => {
  assert.equal(
    isStrongSupportSurveyHit("Final Result", "Support Ada", "genericChallenger"),
    true
  );
  assert.equal(
    isStrongSupportSurveyHit("Final Result", "Support Eunisses", "eunissesTwoWay"),
    true
  );
});

test("sumFinalResultFamilies counts raw Strong Support as generic SS, not a Faizah label", () => {
  const counts = sumFinalResultFamilies(
    [
      { label: "Strong Support", count: 5 },
      { label: "Support Faizah", count: 2 },
      { label: "Undecided", count: 3 },
      { label: "Strong Oppose", count: 1 },
      { label: "Support Traci", count: 4 },
    ],
    "faizahTraci"
  );
  assert.equal(counts.strongSupport, 7);
  assert.equal(counts.undecided, 3);
  assert.equal(counts.strongOppose, 5);
  assert.equal(GENERIC_OUTCOME_LABELS.strongSupport, "Strong support");
  assert.equal(GENERIC_OUTCOME_LABELS.undecided, "Undecided");
  assert.equal(GENERIC_OUTCOME_LABELS.strongOppose, "Strong oppose");
  assert.equal(csvAnswerForFinalResultFamily("strongSupport"), "Strong support");
  assert.doesNotMatch(GENERIC_OUTCOME_LABELS.strongSupport, /faizah/i);
});

test("synthesizedHitMatchesLabel accepts script option text and bucket names", () => {
  const hit = {
    displayLabel: "Support Faizah",
    rawAnswer: "A. Strong Support for Nithya",
  };
  assert.equal(synthesizedHitMatchesLabel(hit, "Support Faizah", "faizahTraci"), true);
  assert.equal(
    synthesizedHitMatchesLabel(hit, "A. Strong Support for Nithya", "faizahTraci"),
    true
  );
  assert.equal(synthesizedHitMatchesLabel(hit, "B. Undecided", "faizahTraci"), false);
});
