import test from "node:test";
import assert from "node:assert/strict";
import { buildTextCampaignsActiveQuery } from "./text-query";

test("text day query includes tags and messages for the Pacific range", () => {
  const sql = buildTextCampaignsActiveQuery("2026-10-20", "2026-10-21");
  assert.match(sql, /campaign_contact_tags/);
  assert.match(sql, /messages/);
  assert.match(sql, /BETWEEN '2026-10-20' AND '2026-10-21'/);
  assert.match(sql, /America\/Los_Angeles/);
});

test("text day query rejects a non-date", () => {
  assert.throws(() => buildTextCampaignsActiveQuery("2026-10-20; drop", "2026-10-21"));
});
