import test from "node:test";
import assert from "node:assert/strict";
import { consolidateSurveyAnswerLines } from "./survey-answer-consolidation";
import {
  applySynthesizedFinalResultsToQuestionRows,
  applySynthesizedHitsToAnswerLines,
  type OverlayQuestionRow,
} from "./final-result-synthesis-overlay";
import type { SynthesizedFinalResultHit } from "./strong-support-from-survey";

function hit(
  partial: Partial<SynthesizedFinalResultHit> & Pick<SynthesizedFinalResultHit, "displayLabel" | "rawAnswer">
): SynthesizedFinalResultHit {
  return {
    callId: "c1",
    campaignId: "camp-f",
    campaignName: "Faizah PB",
    callDate: "2026-09-01",
    phonebankerName: "Jane",
    sourceQuestionName: "01 Polling",
    sourceAnswerValue: partial.rawAnswer,
    reason: "missing_final_result_survey_fill",
    ...partial,
  };
}

test("overlay increments matching Final Result column and synthesizedCount", () => {
  const rows: Record<string, OverlayQuestionRow[]> = {
    "id:camp-f|2026-09-01": [
      {
        phonebankerName: "Jane",
        questionName: "06 Final Result",
        answerValue: "A. Strong Support",
        responseCount: 4,
      },
    ],
  };
  applySynthesizedFinalResultsToQuestionRows(
    rows,
    [hit({ displayLabel: "Support Faizah", rawAnswer: "A. Strong Support" })],
    "faizahTraci"
  );
  const row = rows["id:camp-f|2026-09-01"]![0]!;
  assert.equal(row.responseCount, 5);
  assert.equal(row.synthesizedCount, 1);
});

test("overlay matches classified display label when raw answers differ", () => {
  const rows: Record<string, OverlayQuestionRow[]> = {
    "id:camp-f|2026-09-01": [
      {
        phonebankerName: "Jane",
        questionName: "06 Final Result",
        answerValue: "A. Support Faizah",
        responseCount: 2,
      },
    ],
  };
  applySynthesizedFinalResultsToQuestionRows(
    rows,
    [hit({ displayLabel: "Support Faizah", rawAnswer: "A. Strong Support" })],
    "faizahTraci"
  );
  const row = rows["id:camp-f|2026-09-01"]![0]!;
  assert.equal(row.responseCount, 3);
  assert.equal(row.synthesizedCount, 1);
});

test("overlay uses CSV Strong support / Undecided / Strong oppose names", () => {
  const rows: Record<string, OverlayQuestionRow[]> = {
    "faizah pb|2026-09-01": [
      {
        phonebankerName: "Jane",
        questionName: "Final result",
        answerValue: "Undecided",
        responseCount: 1,
      },
    ],
  };
  applySynthesizedFinalResultsToQuestionRows(
    rows,
    [
      hit({
        campaignId: "",
        campaignName: "Faizah PB",
        displayLabel: "Undecided",
        rawAnswer: "B. Undecided",
      }),
    ],
    "faizahTraci"
  );
  const row = rows["faizah pb|2026-09-01"]!.find((r) => r.answerValue === "Undecided");
  assert.equal(row?.responseCount, 2);
  assert.equal(row?.synthesizedCount, 1);
});

test("overlay does not invent hidden Final result rollup on BQ split-script slices", () => {
  const rows: Record<string, OverlayQuestionRow[]> = {
    "id:camp-f|2026-09-01": [
      {
        phonebankerName: "Jane",
        questionName: "01 Polling",
        answerValue: "A. Strong Support",
        responseCount: 3,
      },
    ],
  };
  applySynthesizedFinalResultsToQuestionRows(
    rows,
    [hit({ displayLabel: "Support Faizah", rawAnswer: "A. Strong Support" })],
    "faizahTraci"
  );
  assert.equal(
    rows["id:camp-f|2026-09-01"]!.some((r) => r.questionName === "Final result"),
    false
  );
  assert.equal(rows["id:camp-f|2026-09-01"]!.length, 1);
});

test("consolidateSurveyAnswerLines sums synthesized counts", () => {
  const lines = consolidateSurveyAnswerLines(
    [
      { label: "A. Strong Support", count: 9, synthesized: 2 },
      { label: "Support Faizah", count: 3, synthesized: 1 },
      { label: "B. Undecided", count: 4, synthesized: 4 },
    ],
    "faizahTraci"
  );
  const ss = lines.find((l) => l.label === "Support Faizah");
  const und = lines.find((l) => l.label === "Undecided");
  assert.equal(ss?.count, 12);
  assert.equal(ss?.synthesized, 3);
  assert.equal(und?.count, 4);
  assert.equal(und?.synthesized, 4);
});

test("applySynthesizedHitsToAnswerLines can annotate without adding counts", () => {
  const lines = applySynthesizedHitsToAnswerLines(
    [{ label: "Undecided", count: 5 }],
    [hit({ displayLabel: "Undecided", rawAnswer: "B. Undecided" })],
    { addCounts: false, verbatim: false, profile: "faizahTraci" }
  );
  assert.equal(lines[0]?.count, 5);
  assert.equal(lines[0]?.synthesized, 1);
});
