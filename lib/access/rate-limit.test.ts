import test from "node:test";
import assert from "node:assert/strict";
import { UNLOCK_RATE_LIMIT_MAX } from "./config";
import { clearUnlockFailures, isUnlockRateLimited, recordUnlockFailure } from "./rate-limit";

test("unlock rate limit trips after 10 failures per session or IP", () => {
  const sessionId = `session-${Date.now()}-a`;
  const ip = `203.0.113.${Date.now() % 200}`;

  assert.equal(isUnlockRateLimited(sessionId, ip), false);

  for (let i = 0; i < UNLOCK_RATE_LIMIT_MAX; i += 1) {
    recordUnlockFailure(sessionId, ip);
  }

  assert.equal(isUnlockRateLimited(sessionId, ip), true);
  assert.equal(isUnlockRateLimited(`other-${sessionId}`, ip), true);
  assert.equal(isUnlockRateLimited(sessionId, "198.51.100.1"), true);

  clearUnlockFailures(sessionId, ip);
  assert.equal(isUnlockRateLimited(sessionId, ip), false);
});
