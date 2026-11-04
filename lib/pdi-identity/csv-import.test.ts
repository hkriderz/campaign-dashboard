import assert from "node:assert/strict";
import test from "node:test";
import { entriesFromPdiIdentityCsv, scanPdiIdentityCsv, suggestPdiIdentityMapping } from "./csv-import";

test("suggestPdiIdentityMapping finds common header aliases", () => {
  const mapping = suggestPdiIdentityMapping(["PRIMARYID", "VOTER", "ADDRESS", "Note"]);
  assert.equal(mapping.pdiIdCol, "PRIMARYID");
  assert.equal(mapping.voterNameCol, "VOTER");
  assert.equal(mapping.voterAddressCol, "ADDRESS");
  assert.equal(mapping.noteCol, "Note");
});

test("scan and import map CSV rows by selected columns", () => {
  const csv = [
    "PRIMARYID,First Name,Last Name,Home Address",
    "ca 1,Ada,Lovelace,1 Main St",
    ",Skip,Me,Nowhere",
    "CA2,Grace,Hopper,2 Oak Ave",
  ].join("\n");

  const scan = scanPdiIdentityCsv(csv);
  assert.equal(scan.columns.length, 4);
  assert.equal(scan.suggestedMapping.pdiIdCol, "PRIMARYID");
  assert.equal(scan.rowCountEstimate, 3);

  const parsed = entriesFromPdiIdentityCsv(csv, {
    pdiIdCol: "PRIMARYID",
    voterNameCol: "",
    voterAddressCol: "Home Address",
    noteCol: "",
  });
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.skippedNoPdiId, 1);
  assert.equal(parsed.entries[0]?.pdiId, "CA1");
  assert.equal(parsed.entries[0]?.voterName, "Ada Lovelace");
  assert.equal(parsed.entries[0]?.voterAddress, "1 Main St");
  assert.equal(parsed.entries[1]?.voterName, "Grace Hopper");
});
