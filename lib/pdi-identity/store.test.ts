import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import { parsePdiIdentityPaste } from "./parse";
import {
  applySavedPdiIdentity,
  deletePdiIdentities,
  listPdiIdentities,
  lookupPdiIdentity,
  setPdiIdentityIndexPathForTests,
  stampKnockRowsWithPdiIdentity,
  stampQcPairsWithPdiIdentity,
  stampRowsWithPdiIdentityMap,
  upsertPdiIdentities,
} from "./store";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdi-identity-"));
const tmpFile = path.join(tmpDir, "pdi-identity.json");

test.before(() => {
  setPdiIdentityIndexPathForTests(tmpFile);
});

test.after(() => {
  setPdiIdentityIndexPathForTests(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("upsert normalizes PDI ids and fills blanks without wiping on empty paste fields", () => {
  const first = upsertPdiIdentities([
    { pdiId: " ca 123 ", voterName: "Ada Lovelace", voterAddress: "1 Main St" },
  ]);
  assert.equal(first.saved.length, 1);
  assert.equal(first.saved[0]?.pdiId, "CA123");

  const second = upsertPdiIdentities([
    { pdiId: "CA123", voterName: "", voterAddress: "2 Oak Ave" },
  ]);
  assert.equal(second.saved[0]?.voterName, "Ada Lovelace");
  assert.equal(second.saved[0]?.voterAddress, "2 Oak Ave");

  const cleared = upsertPdiIdentities([
    { pdiId: "CA123", voterName: "", voterAddress: "", replaceEmpty: true },
  ]);
  assert.equal(cleared.saved[0]?.voterName, "");
  assert.equal(cleared.saved[0]?.voterAddress, "");
});

test("lookup and list return saved rows", () => {
  upsertPdiIdentities([{ pdiId: "CA999", voterName: "Grace", voterAddress: "9 Pine" }]);
  assert.equal(lookupPdiIdentity("ca 999")?.voterName, "Grace");
  assert.ok(listPdiIdentities().some((row) => row.pdiId === "CA999"));
});

test("applySavedPdiIdentity never overwrites non-empty fields", () => {
  const stamped = applySavedPdiIdentity(
    { pdiId: "CA1", voterName: "Existing", voterAddress: "" },
    {
      pdiId: "CA1",
      voterName: "Stored",
      voterAddress: "1 Main",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
  );
  assert.equal(stamped.voterName, "Existing");
  assert.equal(stamped.voterAddress, "1 Main");
});

test("stamp helpers fill blanks on rows, knocks, and QC pairs", () => {
  upsertPdiIdentities([{ pdiId: "CA55", voterName: "Nithya", voterAddress: "100 Hope St" }]);
  const rows = stampRowsWithPdiIdentityMap(
    [{ pdiId: "ca55", voterName: "", voterAddress: "" }],
    { CA55: lookupPdiIdentity("CA55")! }
  );
  assert.equal(rows[0]?.voterName, "Nithya");

  const knocks = stampKnockRowsWithPdiIdentity([{ primaryId: "CA55", voterName: "" }]);
  assert.equal(knocks[0]?.voterName, "Nithya");

  const pairs = stampQcPairsWithPdiIdentity([
    {
      qc: { pdiId: "CA55", voterName: "", voterAddress: "" },
    },
  ]);
  assert.equal(pairs[0]?.qc.voterName, "Nithya");
  assert.equal(pairs[0]?.qc.voterAddress, "100 Hope St");
});

test("delete removes identities", () => {
  upsertPdiIdentities([{ pdiId: "CA777", voterName: "Temp", voterAddress: "x" }]);
  const result = deletePdiIdentities(["ca 777"]);
  assert.deepEqual(result.deleted, ["CA777"]);
  assert.equal(lookupPdiIdentity("CA777"), null);
});

test("parsePdiIdentityPaste accepts TSV and skips headers", () => {
  const parsed = parsePdiIdentityPaste(
    "PDI ID\tName\tAddress\nCA1\tAda\t1 Main\nca 2|Grace|2 Oak\n,orphan name"
  );
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0]?.pdiId, "CA1");
  assert.equal(parsed.entries[1]?.voterName, "Grace");
  assert.equal(parsed.skippedLines, 1);
});
