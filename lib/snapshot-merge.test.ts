import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { laThreeDayWindowStart, mergeRowsByCallDate, upsertById } from "./snapshot-merge";

test("three-day window starts two Pacific days before today", () => {
  const now = DateTime.fromISO("2026-09-28T23:30:00", { zone: "America/Los_Angeles" }).toJSDate();
  assert.equal(laThreeDayWindowStart(now), "2026-09-26");
});

test("merge keeps days before the window and replaces days inside it", () => {
  const existing = [
    { callDate: "2026-09-01", id: "old" },
    { callDate: "2026-09-26", id: "stale" },
    { callDate: "2026-09-28", id: "gone" },
  ];
  const fresh = [
    { callDate: "2026-09-26", id: "new" },
    { callDate: "2026-09-01", id: "ignored-old" },
  ];
  const merged = mergeRowsByCallDate(existing, fresh, "2026-09-26");
  assert.deepEqual(
    merged.map((row) => row.id),
    ["old", "new"]
  );
});

test("upsert replaces contacts by id and keeps the rest", () => {
  const existing = [
    { campaignContactId: "a", result: "old" },
    { campaignContactId: "b", result: "keep" },
  ];
  const fresh = [{ campaignContactId: "a", result: "new" }];
  const merged = upsertById(existing, fresh, (row) => row.campaignContactId);
  assert.deepEqual(merged, [
    { campaignContactId: "a", result: "new" },
    { campaignContactId: "b", result: "keep" },
  ]);
});
