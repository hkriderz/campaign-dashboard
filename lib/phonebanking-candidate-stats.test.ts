import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidateStatsFromDailyCallerStats,
  overlayCampaignRawCallTotals,
} from "./phonebanking-candidate-stats";
import type { CampaignTag, PhoneBankSummary, TagDailyCallerStat } from "./types";

const tag: CampaignTag = {
  id: "nithya",
  label: "Nithya",
  searchTerms: ["nithya"],
  color: "#000",
  textColor: "#fff",
  mode: "phonebanking",
};

function row(partial: Partial<TagDailyCallerStat>): TagDailyCallerStat {
  return {
    campaignId: "d740",
    campaignName: "Nithya PB 9.2 PDI supporters",
    callDate: "2026-09-02",
    phonebankerName: "Ada",
    totalCalls: 0,
    callsAnswered: 1,
    talkingToCorrectPerson: 0,
    surveyed: 1,
    strongSupport: 0,
    numDials: 3,
    totalCallSeconds: 60,
    totalDialerSeconds: 120,
    ...partial,
  };
}

function bank(partial: Partial<PhoneBankSummary> & Pick<PhoneBankSummary, "campaignId" | "totalCalls">): PhoneBankSummary {
  return {
    campaignName: "Nithya PB 9.2 PDI supporters",
    totalDials: 0,
    totalSurveyed: 0,
    uniqueCallers: 0,
    totalHours: 0,
    totalSeconds: 0,
    firstCallDate: "2026-09-02",
    lastCallDate: "2026-09-02",
    campaignCreatedDate: "",
    ...partial,
  };
}

test("candidate Total Calls uses phone-bank raw STW totals, not summed daily-caller zeros", () => {
  const stats = buildCandidateStatsFromDailyCallerStats(
    tag,
    [
      row({ phonebankerName: "Ada", totalCalls: 0, numDials: 3 }),
      row({ phonebankerName: "Bo", totalCalls: 0, numDials: 2 }),
    ],
    new Set(),
    [bank({ campaignId: "d740", totalCalls: 54103 })]
  );
  assert.equal(stats.totalCalls, 54103);
  assert.equal(stats.phoneBanks[0]?.totalCalls, 54103);
  assert.equal(stats.totalDials, 5);
});

test("without phone-bank overlay, Total Calls is MAX per campaign-day then summed", () => {
  const stats = buildCandidateStatsFromDailyCallerStats(tag, [
    row({ callDate: "2026-09-02", totalCalls: 100, numDials: 1 }),
    row({ phonebankerName: "Bo", callDate: "2026-09-02", totalCalls: 100, numDials: 1 }),
    row({ callDate: "2026-09-03", totalCalls: 50, numDials: 1 }),
  ]);
  assert.equal(stats.totalCalls, 150);
});

test("overlayCampaignRawCallTotals replaces listing totals by campaign id", () => {
  const [overlaid] = overlayCampaignRawCallTotals(
    [bank({ campaignId: "d740", totalCalls: 12 })],
    [bank({ campaignId: "d740", totalCalls: 54103 })]
  );
  assert.equal(overlaid?.totalCalls, 54103);
});
