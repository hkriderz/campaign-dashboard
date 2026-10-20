import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWideColumnVisualRows,
  moveWideColumnBlock,
  reorderWideColumnsByVisualRows,
  wideColumnCollapseKey,
} from "./wide-header-utils";

test("answer columns that share a question name collapse together", () => {
  assert.equal(
    wideColumnCollapseKey("2. Disclaimer/Notes: left a message"),
    wideColumnCollapseKey("Disclaimer/Notes")
  );
  assert.equal(
    wideColumnCollapseKey("01 Faizah Ask: A. Yes"),
    wideColumnCollapseKey("01 Faizah Ask: B. No")
  );
  assert.notEqual(wideColumnCollapseKey("Disclaimer: No"), wideColumnCollapseKey("Disclaimer/Notes"));
  assert.equal(wideColumnCollapseKey("Disclaimer: No"), wideColumnCollapseKey("Disclaimer: Yes"));

  const columns = [
    "Caller Name",
    "Date",
    "2. Disclaimer/Notes: left a message",
    "Disclaimer: No",
    "2. Disclaimer/Notes: no answer",
    "Disclaimer: Yes",
  ];
  const open = buildWideColumnVisualRows(columns, new Set());
  assert.deepEqual(
    open.map((row) => row.label),
    columns
  );
  assert.equal(open.every((row) => !row.collapsed), true);
});

test("only questions with more than 10 answers start collapsed", () => {
  const ten = Array.from({ length: 10 }, (_, i) => `Disclaimer/Notes: answer ${i + 1}`);
  const eleven = [...ten, "Disclaimer/Notes: answer 11"];
  assert.equal(buildWideColumnVisualRows(ten, new Set()).length, 10);
  const collapsed = buildWideColumnVisualRows(["Caller Name", ...eleven, "Date"], new Set());
  assert.deepEqual(
    collapsed.map((row) => ({ label: row.label, count: row.indexes.length, collapsed: row.collapsed })),
    [
      { label: "Caller Name", count: 1, collapsed: false },
      { label: "Disclaimer/Notes", count: 11, collapsed: true },
      { label: "Date", count: 1, collapsed: false },
    ]
  );

  const expanded = buildWideColumnVisualRows(["Caller Name", ...eleven], new Set(["disclaimer/notes"]));
  assert.equal(expanded.length, 12);
  assert.equal(expanded[1]?.collapseKey, "disclaimer/notes");
  assert.equal(expanded[1]?.collapsed, false);
  assert.equal(expanded[11]?.label, "Disclaimer/Notes: answer 11");
});

test("moving a collapsed group keeps its columns together", () => {
  const answers = Array.from({ length: 11 }, (_, i) => `Disclaimer/Notes: ${i + 1}`);
  const columns = ["Caller Name", "Date", ...answers, "Hours logged in"];
  const rows = buildWideColumnVisualRows(columns, new Set());
  const moved = reorderWideColumnsByVisualRows(columns, rows, 2, 0);
  assert.deepEqual(moved, [...answers, "Caller Name", "Date", "Hours logged in"]);
  assert.deepEqual(moveWideColumnBlock(columns, rows[2]!.indexes, 1), moved);
  assert.deepEqual(moveWideColumnBlock(columns, rows[2]!.indexes, 3), columns);
});
