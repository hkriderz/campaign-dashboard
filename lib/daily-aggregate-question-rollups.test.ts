import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateScopeRowsFromQuestionSlices,
  buildRollupsByQuestionName,
  mergeRollupsForQuestionGroup,
} from "./daily-aggregate-question-rollups";

test("buildRollupsByQuestionName keeps synthesized Final Result subset", () => {
  const rollups = buildRollupsByQuestionName([
    {
      questionName: "03 Final Result",
      answerValue: "A. Strong Support for Nithya",
      responseCount: 10,
      synthesizedCount: 2,
    },
    {
      questionName: "03 Final Result",
      answerValue: "A. Strong Support for Nithya",
      responseCount: 1,
      synthesizedCount: 1,
    },
    {
      questionName: "03 Final Result",
      answerValue: "B. Undecided",
      responseCount: 4,
    },
  ]);
  const lines = rollups.get("03 Final Result") ?? [];
  const ss = lines.find((l) => l.label === "A. Strong Support for Nithya");
  const und = lines.find((l) => l.label === "B. Undecided");
  assert.equal(ss?.count, 11);
  assert.equal(ss?.synthesized, 3);
  assert.equal(und?.count, 4);
  assert.equal(und?.synthesized, undefined);
});

test("mergeRollupsForQuestionGroup sums synthesized across EN/ES names", () => {
  const rollups = new Map([
    [
      "03 Final Result",
      [{ label: "A. Strong Support", count: 9, synthesized: 2 }],
    ],
    [
      "03 Resultado final",
      [{ label: "A. Strong Support", count: 3, synthesized: 1 }],
    ],
  ]);
  const lines = mergeRollupsForQuestionGroup(
    rollups,
    ["03 Final Result", "03 Resultado final"],
    "faizahTraci"
  );
  const ss = lines.find((l) => l.label.toLowerCase().includes("support") || l.label === "A. Strong Support");
  assert.ok(ss);
  assert.equal(ss?.count, 12);
  assert.equal(ss?.synthesized, 3);
});

test("aggregateScopeRowsFromQuestionSlices copies overlay synthesizedCount", () => {
  const rows = aggregateScopeRowsFromQuestionSlices(
    {
      "id:camp-n|2026-09-08": [
        {
          questionName: "03 Final Result",
          answerValue: "A. Strong Support for Nithya",
          responseCount: 12,
          synthesizedCount: 2,
        },
      ],
      "id:camp-other|2026-09-08": [
        {
          questionName: "03 Final Result",
          answerValue: "B. Undecided",
          responseCount: 1,
        },
      ],
    },
    new Set(["id:camp-n|2026-09-08"])
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.synthesizedCount, 2);
});
