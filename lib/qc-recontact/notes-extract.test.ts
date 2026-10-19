import test from "node:test";
import assert from "node:assert/strict";
import { questionLooksLikeDisclaimerNotes } from "../survey-i18n/disclaimer-notes";
import { questionLooksLikeDisclaimer } from "../survey-i18n/rules";
import { extractCallSurveyLabels } from "./labels";

test("Disclaimer/Notes is notes, not Yes/No disclaimer", () => {
  assert.equal(questionLooksLikeDisclaimerNotes("2. Disclaimer/Notes"), true);
  assert.equal(questionLooksLikeDisclaimer("2. Disclaimer/Notes"), false);
  assert.equal(questionLooksLikeDisclaimer("2. Disclaimer"), true);
  assert.equal(questionLooksLikeDisclaimerNotes("2. Disclaimer"), false);
});

test("extractCallSurveyLabels captures Disclaimer/Notes free text", () => {
  const labels = extractCallSurveyLabels(
    [
      { questionName: "2. Disclaimer", answerValue: "A. Read Disclaimer" },
      { questionName: "Disclaimer/Notes", answerValue: "Voter wants a callback Friday" },
      { questionName: "Were you contacted?", answerValue: "Yes" },
      { questionName: "Final Result", answerValue: "A. Strong Support" },
    ],
    "faizahTraci"
  );
  assert.equal(labels.notesAnswer, "Voter wants a callback Friday");
  assert.equal(labels.contactedAnswer, "Yes");
  assert.ok(labels.finalResultLabel.trim());
});

test("extractCallSurveyLabels ignores blank notes and classic disclaimer answers", () => {
  const labels = extractCallSurveyLabels(
    [
      { questionName: "Disclaimer", answerValue: "A. Read Disclaimer" },
      { questionName: "Disclaimer/Notes", answerValue: "[no answer recorded]" },
    ],
    "faizahTraci"
  );
  assert.equal(labels.notesAnswer, "");
});
