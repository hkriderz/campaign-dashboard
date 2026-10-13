import assert from "node:assert/strict";
import test from "node:test";
import { snapshotFreshnessFromPrefix } from "./bq-snapshot-store";
import { qcSyncWaitsForLaterTag } from "./qc-recontact/refresh-sync";

const header = (rows: string) =>
  `{"version":1,"tagId":"nithya","savedAt":"2026-10-12T20:45:47.437Z","rows":${rows}`;

test("snapshot prefix reads savedAt and whether rows are present", () => {
  const filled = snapshotFreshnessFromPrefix(header('[{"callDate":"2026-10-01"}]'), "nithya");
  assert.equal(filled?.savedAt, "2026-10-12T20:45:47.437Z");
  assert.equal(filled?.hasRows, true);
  const empty = snapshotFreshnessFromPrefix(header("[]"), "nithya");
  assert.equal(empty?.hasRows, false);
  assert.equal(snapshotFreshnessFromPrefix(header("[]"), "faizah"), null);
});

test("recontact pair files use the pairs array", () => {
  const head = `{"version":1,"tagId":"qc-nithya","savedAt":"2026-10-12T03:31:14.215Z","pairs":[{"pairId":"1"}]`;
  const probe = snapshotFreshnessFromPrefix(head, "qc-nithya");
  assert.equal(probe?.hasRows, true);
  assert.equal(probe?.savedAt, "2026-10-12T03:31:14.215Z");
});

test("refresh all waits to sync QC until the later counterpart tag", () => {
  assert.equal(qcSyncWaitsForLaterTag("nithya", ["faizah", "qc-nithya"]), true);
  assert.equal(qcSyncWaitsForLaterTag("qc-nithya", ["faizah"]), false);
  assert.equal(qcSyncWaitsForLaterTag("qc-nithya", ["nithya"]), true);
  assert.equal(qcSyncWaitsForLaterTag("nithya", ["faizah"]), false);
});
