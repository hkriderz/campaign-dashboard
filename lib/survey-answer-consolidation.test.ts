import test from "node:test";
import assert from "node:assert/strict";
import { isStrongSupportSurveyHit } from "./survey-answer-consolidation";

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
