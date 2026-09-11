import test from "node:test";
import assert from "node:assert/strict";
import {
  phonebankerDailyStatHasVisibleWork,
  tagDailyCallerHasWorkBeyondLoggedHours,
} from "./phonebank-session-work";

test("idle View row with 0 dials, 0.00h, and 0 surveyed is dropped", () => {
  assert.equal(
    phonebankerDailyStatHasVisibleWork({
      phonebankerName: "Jane Doe",
      numDials: 0,
      totalCallHours: 0,
      surveyed: 0,
      strongSupport: 0,
    }),
    false
  );
});

test("surveyed-only View row is kept", () => {
  assert.equal(
    phonebankerDailyStatHasVisibleWork({
      phonebankerName: "Jane Doe",
      numDials: 0,
      totalCallHours: 0,
      surveyed: 3,
      strongSupport: 0,
    }),
    true
  );
});

test("inflated totalCalls alone is not tag-level work", () => {
  assert.equal(
    tagDailyCallerHasWorkBeyondLoggedHours({
      campaignId: "x",
      campaignName: "Bank",
      callDate: "2026-09-02",
      phonebankerName: "Idle",
      totalCalls: 400,
      callsAnswered: 0,
      talkingToCorrectPerson: 0,
      surveyed: 0,
      strongSupport: 0,
      numDials: 0,
      totalCallSeconds: 0,
      totalDialerSeconds: 3600,
    }),
    false
  );
});
