import test from "node:test";
import assert from "node:assert/strict";
import { createAccessToken, passwordsMatch, verifyAccessToken } from "./token";

test("passwordsMatch accepts the same string and rejects a different one", async () => {
  assert.equal(await passwordsMatch("correct-horse", "correct-horse"), true);
  assert.equal(await passwordsMatch("correct-horse", "correct-horse!"), false);
  assert.equal(await passwordsMatch("", "x"), false);
});

test("access token verifies only for the matching session and password", async () => {
  const token = await createAccessToken("11111111-1111-4111-8111-111111111111", "staff-secret");
  assert.equal(
    await verifyAccessToken("11111111-1111-4111-8111-111111111111", token, "staff-secret"),
    true
  );
  assert.equal(
    await verifyAccessToken("11111111-1111-4111-8111-111111111111", token, "other-secret"),
    false
  );
  assert.equal(
    await verifyAccessToken("22222222-2222-4222-8222-222222222222", token, "staff-secret"),
    false
  );
  assert.equal(
    await verifyAccessToken("11111111-1111-4111-8111-111111111111", "not-a-token", "staff-secret"),
    false
  );
});
