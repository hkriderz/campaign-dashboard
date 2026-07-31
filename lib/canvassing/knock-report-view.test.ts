import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildShiftFlagRows,
  defaultShiftSettings,
  type KnockShiftSettings,
} from "./knock-report-view";
import type { CanvasserGapStats } from "./types";

function stats(partial: Partial<CanvasserGapStats> & { canvasserName: string }): CanvasserGapStats {
  return {
    knockCount: 10,
    firstKnockAt: null,
    mostRecentKnockAt: null,
    largestGapMinutes: 0,
    largestGapStartAt: null,
    largestGapEndAt: null,
    totalGapMinutesOver10: 0,
    averageNonZeroGapMinutes: 0,
    averageGapEndingInContactMinutes: null,
    gapCountOver10: 0,
    bigGapCountOver30: 0,
    hourGapCount: 0,
    outlierGapCount: 0,
    ...partial,
  };
}

describe("defaultShiftSettings", () => {
  it("uses 12:30 start, 3:30–4:00 lunch, 7:30 last knock", () => {
    const lunch = defaultShiftSettings("lunch");
    assert.equal(lunch.startTime, "12:30");
    assert.equal(lunch.lunchClockOutTime, "15:30");
    assert.equal(lunch.lunchReturnTime, "16:00");
    assert.equal(lunch.endTime, "19:30");

    const final = defaultShiftSettings("final");
    assert.equal(final.startTime, "12:30");
    assert.equal(final.endTime, "19:30");
  });
});

describe("buildShiftFlagRows still-on-lunch", () => {
  const settings: KnockShiftSettings = {
    mode: "lunch",
    startTime: "12:30",
    lunchClockOutTime: "15:30",
    lunchReturnTime: "16:00",
    endTime: "19:30",
    asOfTime: "16:30",
  };
  const reportDate = "2026-07-21";

  it("flags canvassers with no knock at/after lunch return when as-of is past return", () => {
    const rows = buildShiftFlagRows(
      [
        stats({
          canvasserName: "Still Out",
          firstKnockAt: "2026-07-21T12:40:00.000-07:00",
          mostRecentKnockAt: "2026-07-21T15:35:00.000-07:00",
        }),
        stats({
          canvasserName: "Back On Doors",
          firstKnockAt: "2026-07-21T12:40:00.000-07:00",
          mostRecentKnockAt: "2026-07-21T16:05:00.000-07:00",
        }),
      ],
      settings,
      reportDate
    );

    const still = rows.find((r) => r.canvasserName === "Still Out");
    const back = rows.find((r) => r.canvasserName === "Back On Doors");
    assert.equal(still?.isStillOnLunch, true);
    assert.equal(back?.isStillOnLunch, false);
  });

  it("does not flag still-on-lunch before lunch return even if last knock is old", () => {
    const rows = buildShiftFlagRows(
      [
        stats({
          canvasserName: "Mid Lunch",
          firstKnockAt: "2026-07-21T12:40:00.000-07:00",
          mostRecentKnockAt: "2026-07-21T15:35:00.000-07:00",
        }),
      ],
      { ...settings, asOfTime: "15:45" },
      reportDate
    );
    assert.equal(rows[0]?.isStillOnLunch, false);
  });

  it("applies 30-minute grace before late first knock", () => {
    const withinGrace = buildShiftFlagRows(
      [
        stats({
          canvasserName: "Within Grace",
          firstKnockAt: "2026-07-21T12:45:00.000-07:00",
          mostRecentKnockAt: "2026-07-21T16:10:00.000-07:00",
        }),
      ],
      settings,
      reportDate
    );
    assert.equal(withinGrace[0]?.isLateFirstKnock, false);

    const late = buildShiftFlagRows(
      [
        stats({
          canvasserName: "Late",
          firstKnockAt: "2026-07-21T13:00:00.000-07:00",
          mostRecentKnockAt: "2026-07-21T16:10:00.000-07:00",
        }),
      ],
      settings,
      reportDate
    );
    assert.equal(late[0]?.isLateFirstKnock, true);
    assert.equal(late[0]?.minutesLateAfterStart, 30);
  });
});
