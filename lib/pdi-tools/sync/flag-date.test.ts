import test from "node:test";
import assert from "node:assert/strict";
import { buildSurveyQuery } from "./query";
import { buildTextTagQuery } from "./text-query";
import { extractFlagDate } from "./transform";

test("dialer sync dates each call in Pacific time on that call's campaign", () => {
  const sql = buildSurveyQuery("2026-09-01T00:00:00", "2026-09-30T23:59:59");
  assert.match(sql, /COALESCE\(calls\.connected_at, calls\.created_at\)/);
  assert.match(sql, /America\/Los_Angeles/);
  assert.match(sql, /ON calls\.campaign_id = campaigns\.id/);
  assert.match(sql, /survey\.deleted_at IS NULL/);
  assert.doesNotMatch(sql, /survey\.campaign_id/);
  assert.doesNotMatch(sql, /DATETIME\(calls\.connected_at\) AS call_time/);
});

test("text sync dates a tag on the day it was applied", () => {
  const sql = buildTextTagQuery("2026-09-01T00:00:00", "2026-09-02T00:00:00");
  assert.match(sql, /DATETIME\(campaign_contact_tags\.created_at, 'America\/Los_Angeles'\) AS call_time/);
  assert.doesNotMatch(sql, /campaigns\.started_at/);
  assert.doesNotMatch(sql, /campaigns\.created_at/);
});

test("extractFlagDate keeps the Pacific calendar day of an evening call", () => {
  assert.equal(extractFlagDate("2026-09-26 23:30:00"), "2026-09-26");
  assert.equal(extractFlagDate({ value: "2026-09-26T23:30:00" }), "2026-09-26");
  assert.equal(extractFlagDate("2026-09-09 16:12:00"), "2026-09-09");
});
