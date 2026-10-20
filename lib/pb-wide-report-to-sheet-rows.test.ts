import test from "node:test";
import assert from "node:assert/strict";
import { classifyWideHeaders } from "./pb-wide-report-to-sheet-rows";
import { applyWideColumnOrderToCsvText } from "./wide-csv-column-order";

test("Disclaimer/Notes stays off the Yes/No disclaimer rollup", () => {
  const items = classifyWideHeaders([
    "Caller Name",
    "Date",
    "Disclaimer/Notes",
    "2. Disclaimer/Notes: left a message",
    "Disclaimer: No",
    "Disclaimer: Yes",
  ]);
  const byHeader = new Map(items.map((item) => [item.header, item]));

  assert.equal(byHeader.get("Disclaimer/Notes")?.sheetField, undefined);
  assert.equal(byHeader.get("2. Disclaimer/Notes: left a message")?.sheetField, undefined);
  assert.equal(byHeader.get("Disclaimer: No")?.sheetField, "disclaimerNo");
  assert.equal(byHeader.get("Disclaimer: Yes")?.sheetField, "disclaimerYes");
});

test("columns left out of the import order are omitted from the CSV", () => {
  const csv = ["Caller Name,Date,Disclaimer/Notes,Disclaimer: No", "Ada,2026-10-01,3,1"].join("\n");
  const out = applyWideColumnOrderToCsvText(csv, ["Caller Name", "Date", "Disclaimer: No"]);
  assert.match(out, /Disclaimer: No/);
  assert.doesNotMatch(out, /Disclaimer\/Notes/);
});
