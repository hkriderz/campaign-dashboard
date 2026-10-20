import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseDisclaimerNotesPivotHeaders,
  disclaimerNotesPivotColumn,
  isDisclaimerNotesPivotSource,
  upsertPivotAnswerColumn,
} from "./pivot-disclaimer-notes";

test("Disclaimer/Notes folds to one N/A column and Yes/No disclaimer does not", () => {
  assert.equal(isDisclaimerNotesPivotSource("2. Disclaimer/Notes: left a message"), true);
  assert.equal(isDisclaimerNotesPivotSource("Disclaimer/Notes"), true);
  assert.equal(isDisclaimerNotesPivotSource("Disclaimer: No"), false);
  assert.equal(isDisclaimerNotesPivotSource("Disclaimer: Yes"), false);

  const cols = new Map();
  upsertPivotAnswerColumn(cols, "2. Disclaimer/Notes", "left a message");
  upsertPivotAnswerColumn(cols, "2. Disclaimer/Notes", "needs a callback");
  upsertPivotAnswerColumn(cols, "Disclaimer/Notes: spoke in Spanish", "");
  upsertPivotAnswerColumn(cols, "01 Faizah Ask", "A. Yes");
  upsertPivotAnswerColumn(cols, "Disclaimer: No", "");

  assert.deepEqual(
    [...cols.values()].map((col) => ({
      questionName: col.questionName,
      answerValue: col.answerValue,
      notesNa: col.notesNa ?? false,
    })),
    [
      { questionName: "Disclaimer/Notes", answerValue: "N/A", notesNa: true },
      { questionName: "01 Faizah Ask", answerValue: "A. Yes", notesNa: false },
      { questionName: "Disclaimer: No", answerValue: "", notesNa: false },
    ]
  );
  assert.equal(disclaimerNotesPivotColumn("2. Disclaimer/Notes: left a message").key, cols.get("notes-na::disclaimer/notes")?.key);
});

test("wide header order keeps one notes slot where the first notes column was", () => {
  assert.deepEqual(
    collapseDisclaimerNotesPivotHeaders([
      "01 Faizah Ask: A. Yes",
      "2. Disclaimer/Notes: left a message",
      "2. Disclaimer/Notes: no answer",
      "Disclaimer: No",
      "Disclaimer: Yes",
    ]),
    ["01 Faizah Ask: A. Yes", "Disclaimer/Notes", "Disclaimer: No", "Disclaimer: Yes"]
  );
});
