import test from "node:test";
import assert from "node:assert/strict";
import { campaignBelongsInDailyAggregate, campaignNameLooksLikeQc } from "./campaign-tags";

test("campaignNameLooksLikeQc matches STW QC list names", () => {
  assert.equal(campaignNameLooksLikeQc("Nithya QC PB 9.12"), true);
  assert.equal(campaignNameLooksLikeQc("Nithya PB 9.9 Revocation Signers"), false);
  assert.equal(campaignNameLooksLikeQc(""), false);
});

test("Daily Aggregate membership splits candidate, QC, and All Campaigns", () => {
  assert.equal(campaignBelongsInDailyAggregate("Nithya PB 9.9", "primary"), true);
  assert.equal(campaignBelongsInDailyAggregate("Nithya QC PB 9.12", "primary"), false);
  assert.equal(campaignBelongsInDailyAggregate("Nithya PB 9.9", "qc"), false);
  assert.equal(campaignBelongsInDailyAggregate("Nithya QC PB 9.12", "qc"), true);
  assert.equal(campaignBelongsInDailyAggregate("Nithya PB 9.9", "all"), true);
  assert.equal(campaignBelongsInDailyAggregate("Nithya QC PB 9.12", "all"), true);
});
