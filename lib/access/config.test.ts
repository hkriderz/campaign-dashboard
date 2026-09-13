import test from "node:test";
import assert from "node:assert/strict";
import { isGatedSectionApiPath } from "./config";

test("isGatedSectionApiPath covers canvassing and district APIs only", () => {
  assert.equal(isGatedSectionApiPath("/api/canvassing"), true);
  assert.equal(isGatedSectionApiPath("/api/canvassing/overview"), true);
  assert.equal(isGatedSectionApiPath("/api/district-classifier/jobs"), true);
  assert.equal(isGatedSectionApiPath("/api/access/unlock"), false);
  assert.equal(isGatedSectionApiPath("/api/phonebanking/campaigns"), false);
  assert.equal(isGatedSectionApiPath("/canvassing"), false);
});
