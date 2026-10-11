import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import {
  createdAtOnOrAfterSql,
  laThreeDayWindowStart,
  mergeRowsByCallDate,
  mergeTextContactWindow,
  paddedCreatedAtRangeSql,
  refreshWindowStartDate,
  upsertById,
} from "./snapshot-merge";

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

test("refresh window starts at the Pacific day before the query start", () => {
  assert.equal(refreshWindowStartDate("2026-10-11T22:00:00.000Z"), "2026-10-10");
  assert.equal(
    createdAtOnOrAfterSql("calls.created_at", "2026-10-10"),
    "calls.created_at >= TIMESTAMP('2026-10-10', 'America/Los_Angeles')"
  );
  assert.match(paddedCreatedAtRangeSql("calls.created_at", "2026-10-11", "2026-10-11"), /2026-10-10/);
  assert.match(paddedCreatedAtRangeSql("calls.created_at", "2026-10-11", "2026-10-11"), /2026-10-13/);
});

test("text contact window keeps a stored PDI id and inbound reply", () => {
  const existing = [
    {
      campaignContactId: "c1",
      campaignId: "camp",
      campaignName: "Ada",
      pdiId: "CA1",
      texterName: "Pat",
      occurredOn: "2026-10-01",
      occurredAt: "2026-10-01T12:00:00",
      resultLabel: "Support",
      hasMessages: true,
      hasInboundReply: true,
    },
  ];
  const fresh = [
    {
      campaignContactId: "c1",
      campaignId: "camp",
      campaignName: "Ada",
      pdiId: "",
      texterName: "Sam",
      occurredOn: "2026-10-11",
      occurredAt: "2026-10-11T15:00:00",
      resultLabel: "Moved",
      hasMessages: true,
      hasInboundReply: false,
    },
  ];
  const merged = mergeTextContactWindow(existing, fresh);
  assert.equal(merged[0]?.pdiId, "CA1");
  assert.equal(merged[0]?.hasInboundReply, true);
  assert.equal(merged[0]?.resultLabel, "Moved");
  assert.equal(merged[0]?.texterName, "Sam");
  assert.equal(merged[0]?.occurredAt, "2026-10-11T15:00:00");
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
