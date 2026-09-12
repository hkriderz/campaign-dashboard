import test from "node:test";
import assert from "node:assert/strict";
import {
  campaignDayRawCallTotals,
  indexPhoneBankDayRawCalls,
  isFullDashboardDateWindow,
  lookupPhoneBankDayRawCalls,
  rawStwCallsForCampaignDay,
  sessionRawStwCalls,
  stampAndKeepCampaignDayRawCalls,
  stampCampaignDayRawCalls,
  sumRawStwCallsByCampaignDay,
} from "./raw-stw-calls";
import { tagDailyCallerHasWorkBeyondLoggedHours } from "./phonebank-session-work";
import type { TagDailyCallerStat } from "./types";

function row(partial: Partial<TagDailyCallerStat> & Pick<TagDailyCallerStat, "phonebankerName">): TagDailyCallerStat {
  return {
    campaignId: "camp-a",
    campaignName: "Nithya PB 9.2 PDI supporters",
    callDate: "2026-09-02",
    totalCalls: 0,
    callsAnswered: 0,
    talkingToCorrectPerson: 0,
    surveyed: 0,
    strongSupport: 0,
    numDials: 0,
    totalCallSeconds: 0,
    totalDialerSeconds: 0,
    ...partial,
  };
}

test("rawStwCallsForCampaignDay takes MAX, never SUM", () => {
  assert.equal(
    rawStwCallsForCampaignDay([
      { totalCalls: 54103 },
      { totalCalls: 0 },
      { totalCalls: 12 },
    ]),
    54103
  );
});

test("stamp copies the parked campaign-day total onto every banker", () => {
  const rows = [
    row({ phonebankerName: "", totalCalls: 54103 }),
    row({ phonebankerName: "Ada", totalCalls: 0, numDials: 4 }),
  ];
  const stamped = stampCampaignDayRawCalls(rows, campaignDayRawCallTotals(rows));
  assert.equal(stamped[0]?.totalCalls, 54103);
  assert.equal(stamped[1]?.totalCalls, 54103);
});

test("idle filter after stamp keeps the day total on working bankers", () => {
  const kept = stampAndKeepCampaignDayRawCalls(
    [
      row({ phonebankerName: "", totalCalls: 54103, totalDialerSeconds: 3600 }),
      row({ phonebankerName: "Ada", totalCalls: 0, numDials: 4, surveyed: 2 }),
    ],
    tagDailyCallerHasWorkBeyondLoggedHours
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.phonebankerName, "Ada");
  assert.equal(kept[0]?.totalCalls, 54103);
});

test("isFullDashboardDateWindow is true only when every slice is visible", () => {
  const all = ["a|2026-09-02", "b|2026-09-03"];
  assert.equal(isFullDashboardDateWindow(all, all), true);
  assert.equal(isFullDashboardDateWindow(["a|2026-09-02"], all), false);
  assert.equal(isFullDashboardDateWindow([], all), false);
});

test("sumRawStwCallsByCampaignDay adds MAX per day, not per banker", () => {
  const rows = [
    row({ phonebankerName: "A", callDate: "2026-09-02", totalCalls: 100, numDials: 1 }),
    row({ phonebankerName: "B", callDate: "2026-09-02", totalCalls: 100, numDials: 1 }),
    row({ phonebankerName: "A", callDate: "2026-09-03", campaignId: "camp-a", totalCalls: 50, numDials: 1 }),
  ];
  assert.equal(sumRawStwCallsByCampaignDay(rows), 150);
});

test("sessionRawStwCalls prefers daily-caller MAX, then the day summary", () => {
  assert.equal(sessionRawStwCalls([{ totalCalls: 0 }, { totalCalls: 12 }], 400), 12);
  assert.equal(sessionRawStwCalls([{ totalCalls: 0 }, { totalCalls: 0 }], 400), 400);
  assert.equal(sessionRawStwCalls([], 400), 400);
  assert.equal(sessionRawStwCalls([{ totalCalls: 0 }], 0), 0);
});

test("lookupPhoneBankDayRawCalls matches campaign id, then name", () => {
  const index = indexPhoneBankDayRawCalls([
    { campaignId: "camp-a", campaignName: "Nithya PB 9.2", callDate: "2026-09-02", totalCalls: 54103 },
  ]);
  assert.equal(lookupPhoneBankDayRawCalls(index, "camp-a", "Nithya PB 9.2", "2026-09-02"), 54103);
  assert.equal(lookupPhoneBankDayRawCalls(index, "", "Nithya PB 9.2", "2026-09-02"), 54103);
  assert.equal(lookupPhoneBankDayRawCalls(index, "camp-a", "Nithya PB 9.2", "2026-09-03"), 0);
});
