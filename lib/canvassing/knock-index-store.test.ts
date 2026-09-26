import test from "node:test";
import assert from "node:assert/strict";
import { mergeKnockIndexRows } from "./knock-index-store";
import type { QcCanvassKnockIndexRow } from "../qc-recontact/types";

function row(partial: Partial<QcCanvassKnockIndexRow> & Pick<QcCanvassKnockIndexRow, "primaryId">): QcCanvassKnockIndexRow {
  return {
    canvasserName: "Sam Door",
    assignmentName: "Turf A",
    occurredAt: "2026-03-02T15:00:00",
    question: "Support?",
    response: "Yes",
    reportId: "rep-1",
    ...partial,
  };
}

test("mergeKnockIndexRows backfills a blank voter name without adding a duplicate", () => {
  const existing = [row({ primaryId: "CA1" })];
  const incoming = [row({ primaryId: "ca1", voterName: "Ada Lovelace" })];
  const merged = mergeKnockIndexRows(existing, incoming);
  assert.equal(merged.rowsAdded, 0);
  assert.equal(merged.rowsSkippedDup, 1);
  assert.equal(merged.voterNamesFilled, 1);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0]?.voterName, "Ada Lovelace");
});

test("mergeKnockIndexRows leaves an existing voter name in place", () => {
  const existing = [row({ primaryId: "CA1", voterName: "Grace Hopper" })];
  const incoming = [row({ primaryId: "CA1", voterName: "Ada Lovelace" })];
  const merged = mergeKnockIndexRows(existing, incoming);
  assert.equal(merged.voterNamesFilled, 0);
  assert.equal(merged.rows[0]?.voterName, "Grace Hopper");
});
