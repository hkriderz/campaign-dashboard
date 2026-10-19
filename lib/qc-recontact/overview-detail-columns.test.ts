import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_OVERVIEW_DETAIL_COLUMN_IDS,
  buildOverviewDetailTsv,
  defaultVisibleOverviewDetailColumnIds,
  filterOverviewRowsByHasNotes,
  overviewDetailHasNotes,
  overviewDetailHeadersForColumns,
  parseOverviewDetailColumnIds,
  toggleOverviewDetailColumn,
} from "./overview-detail-columns";

test("default overview detail columns include Notes", () => {
  const ids = defaultVisibleOverviewDetailColumnIds();
  assert.ok(ids.includes("notesAnswer"));
  assert.equal(ids.length, ALL_OVERVIEW_DETAIL_COLUMN_IDS.length);
});

test("saved layout missing notesAnswer treats Notes as on", () => {
  const withoutNotes = ALL_OVERVIEW_DETAIL_COLUMN_IDS.filter((id) => id !== "notesAnswer");
  const parsed = parseOverviewDetailColumnIds(JSON.stringify(withoutNotes));
  assert.ok(parsed?.includes("notesAnswer"));
});

test("toggle cannot clear the last column", () => {
  const only = toggleOverviewDetailColumn(["pdiId"], "pdiId", false);
  assert.deepEqual(only, ["pdiId"]);
});

test("TSV and headers respect visible columns including Notes", () => {
  const ids = ["pdiId", "notesAnswer"] as const;
  const headers = overviewDetailHeadersForColumns(ids, "canvasser");
  assert.deepEqual(headers, ["PDI", "Notes"]);
  const tsv = buildOverviewDetailTsv(
    [
      {
        canvasserName: "Ada",
        originalFlag: "SS",
        originalFlagDate: "2026-09-01",
        pdiId: "CA1",
        voterFirstName: "Pat",
        voterLastName: "Lee",
        address: "1 Main",
        contactedAnswer: "Yes",
        notesAnswer: "Called back",
        pollingLabel: "SS",
        finalResultLabel: "SS",
        callerName: "QC",
        callDate: "2026-09-12",
        callTime: "12:00:00",
      },
    ],
    ids,
    "canvasser"
  );
  assert.equal(tsv, "PDI\tNotes\nCA1\tCalled back");
});

test("filterOverviewRowsByHasNotes keeps only actors with note details", () => {
  const rows = [
    {
      name: "Ada",
      details: [
        { notesAnswer: "Called back" },
        { notesAnswer: "" },
      ],
    },
    {
      name: "Bea",
      details: [{ notesAnswer: "" }, { notesAnswer: "[no answer recorded]" }],
    },
  ];
  assert.equal(overviewDetailHasNotes({ notesAnswer: "Called back" }), true);
  assert.equal(overviewDetailHasNotes({ notesAnswer: "" }), false);
  const filtered = filterOverviewRowsByHasNotes(rows, true);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.name, "Ada");
  assert.equal(filtered[0]?.details.length, 1);
  assert.equal(filtered[0]?.details[0]?.notesAnswer, "Called back");
  assert.equal(filterOverviewRowsByHasNotes(rows, false), rows);
});
