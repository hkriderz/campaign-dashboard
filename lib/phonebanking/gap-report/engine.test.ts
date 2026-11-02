import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzePhonebankGapCalls } from "./engine";
import { builtInPhonebankGapShiftSettings } from "./shift";
import type { PhonebankCallEvent, PhonebankGapShiftSettings } from "./types";

const workDate = "2026-09-16";

function call(
  partial: Partial<PhonebankCallEvent> &
    Pick<PhonebankCallEvent, "callId" | "phonebankerName" | "dialedAt" | "endedAt">
): PhonebankCallEvent {
  return {
    campaignId: "camp-1",
    campaignName: "Test Bank",
    workDate,
    connectedAt: partial.connectedAt ?? partial.dialedAt,
    durationSeconds: partial.durationSeconds ?? 30,
    connected: partial.connected ?? true,
    disposition: partial.disposition ?? "",
    telephonyStatus: partial.telephonyStatus ?? "completed",
    ...partial,
  };
}

const shift: PhonebankGapShiftSettings = {
  ...builtInPhonebankGapShiftSettings(),
  asOfTime: "16:30",
};

describe("analyzePhonebankGapCalls", () => {
  it("keeps Pacific day buckets and does not merge across midnight", () => {
    // UTC midnight-crossing instants that are still 2026-09-16 Pacific afternoon/evening.
    const dayCalls = [
      call({
        callId: "a1",
        phonebankerName: "Ava",
        dialedAt: "2026-09-16T19:30:00.000-07:00",
        endedAt: "2026-09-16T19:31:00.000-07:00",
      }),
      call({
        callId: "a2",
        phonebankerName: "Ava",
        dialedAt: "2026-09-16T19:40:00.000-07:00",
        endedAt: "2026-09-16T19:41:00.000-07:00",
      }),
    ];
    const result = analyzePhonebankGapCalls(dayCalls, workDate, shift);
    assert.equal(result.summary.callCount, 2);
    assert.equal(result.gapDetails.length, 1);
    assert.equal(result.gapDetails[0]?.gapMinutes, 9);
  });

  it("treats null-connect rows as point events at dial time", () => {
    const result = analyzePhonebankGapCalls(
      [
        call({
          callId: "n1",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T12:30:00.000-07:00",
          connectedAt: null,
          endedAt: "2026-09-16T12:30:00.000-07:00",
          connected: false,
          durationSeconds: 0,
        }),
        call({
          callId: "n2",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T12:45:00.000-07:00",
          connectedAt: null,
          endedAt: "2026-09-16T12:45:00.000-07:00",
          connected: false,
          durationSeconds: 0,
        }),
      ],
      workDate,
      shift
    );
    assert.equal(result.phonebankerStats[0]?.connectedCount, 0);
    assert.equal(result.gapDetails[0]?.gapMinutes, 15);
    assert.equal(result.gapDetails[0]?.gapAtOrAbove15, true);
  });

  it("clamps overlap gaps to zero and marks isOverlap", () => {
    const result = analyzePhonebankGapCalls(
      [
        call({
          callId: "o1",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T12:30:00.000-07:00",
          endedAt: "2026-09-16T12:35:00.000-07:00",
        }),
        call({
          callId: "o2",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T12:34:00.000-07:00",
          endedAt: "2026-09-16T12:36:00.000-07:00",
        }),
      ],
      workDate,
      shift
    );
    const gap = result.gapDetails.find((g) => g.isOverlap);
    assert.ok(gap);
    assert.equal(gap?.gapMinutes, 0);
    assert.equal(gap?.isOverlap, true);
  });

  it("highlights lunch only when the gap runs past lunch return", () => {
    const pastReturn = analyzePhonebankGapCalls(
      [
        call({
          callId: "l1",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T15:20:00.000-07:00",
          endedAt: "2026-09-16T15:25:00.000-07:00",
        }),
        call({
          callId: "l2",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T16:10:00.000-07:00",
          endedAt: "2026-09-16T16:12:00.000-07:00",
        }),
      ],
      workDate,
      shift
    );
    assert.equal(pastReturn.gapDetails[0]?.overlapsLunch, true);
    assert.equal(pastReturn.gapDetails[0]?.highlightLunchLong, true);

    // Long gap fully before return: overlaps lunch window but does not run past return.
    const beforeReturn = analyzePhonebankGapCalls(
      [
        call({
          callId: "l3",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T15:00:00.000-07:00",
          endedAt: "2026-09-16T15:10:00.000-07:00",
        }),
        call({
          callId: "l4",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T15:55:00.000-07:00",
          endedAt: "2026-09-16T15:56:00.000-07:00",
        }),
      ],
      workDate,
      shift
    );
    assert.equal(beforeReturn.gapDetails[0]?.overlapsLunch, true);
    assert.ok((beforeReturn.gapDetails[0]?.gapMinutes ?? 0) > 40);
    assert.equal(beforeReturn.gapDetails[0]?.highlightLunchLong, false);
  });

  it("highlights scheduled break gaps longer than 18 minutes", () => {
    const result = analyzePhonebankGapCalls(
      [
        call({
          callId: "b1",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T14:50:00.000-07:00",
          endedAt: "2026-09-16T14:55:00.000-07:00",
        }),
        call({
          callId: "b2",
          phonebankerName: "Ava",
          dialedAt: "2026-09-16T15:20:00.000-07:00",
          endedAt: "2026-09-16T15:21:00.000-07:00",
        }),
      ],
      workDate,
      shift
    );
    // Default pre-lunch break is 15:00–15:10; gap 14:55→15:20 overlaps and is 25m.
    assert.equal(result.gapDetails[0]?.overlapsPreLunchBreak, true);
    assert.equal(result.gapDetails[0]?.highlightBreakLong, true);
  });

  it("flags late first call after 30-minute grace from 12:30", () => {
    const late = analyzePhonebankGapCalls(
      [
        call({
          callId: "late1",
          phonebankerName: "Late",
          dialedAt: "2026-09-16T13:05:00.000-07:00",
          endedAt: "2026-09-16T13:06:00.000-07:00",
        }),
      ],
      workDate,
      shift
    );
    assert.equal(late.shiftFlags[0]?.isLateFirstCall, true);

    const onTime = analyzePhonebankGapCalls(
      [
        call({
          callId: "ok1",
          phonebankerName: "OnTime",
          dialedAt: "2026-09-16T12:50:00.000-07:00",
          endedAt: "2026-09-16T12:51:00.000-07:00",
        }),
      ],
      workDate,
      shift
    );
    assert.equal(onTime.shiftFlags[0]?.isLateFirstCall, false);
  });

  it("flags still-on-lunch when last end is before lunch return and as-of is after", () => {
    const result = analyzePhonebankGapCalls(
      [
        call({
          callId: "s1",
          phonebankerName: "Sidney",
          dialedAt: "2026-09-16T12:30:00.000-07:00",
          endedAt: "2026-09-16T15:40:00.000-07:00",
        }),
      ],
      workDate,
      shift
    );
    assert.equal(result.shiftFlags[0]?.isStillOnLunch, true);
  });
});
