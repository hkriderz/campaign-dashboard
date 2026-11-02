import { DateTime } from "luxon";
import {
  buildPhonebankShiftFlagRows,
  classifyGapWindowHighlights,
  gapExtendsPastLunchReturn,
  gapOverlapsLunchWindow,
  gapOverlapsScheduledBreak,
} from "./shift";
import type {
  PhonebankCallEvent,
  PhonebankGapDetail,
  PhonebankGapReportResult,
  PhonebankGapShiftSettings,
  PhonebankerDayStats,
} from "./types";

const GAP_5 = 5;
const GAP_15 = 15;
const GAP_30 = 30;
const GAP_60 = 60;

function roundMinutes(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return roundMinutes((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return roundMinutes(sorted[mid]!);
}

function sortCalls(calls: PhonebankCallEvent[]): PhonebankCallEvent[] {
  return [...calls].sort((a, b) => {
    const byName = a.phonebankerName.localeCompare(b.phonebankerName);
    if (byName) return byName;
    const byDial = a.dialedAt.localeCompare(b.dialedAt);
    if (byDial) return byDial;
    return a.callId.localeCompare(b.callId);
  });
}

/**
 * Build per-person Pacific-day timelines and gaps.
 * Gap = next dial − previous end. Negative gaps clamp to 0 and mark overlap.
 */
export function analyzePhonebankGapCalls(
  calls: PhonebankCallEvent[],
  workDate: string,
  shiftSettings: PhonebankGapShiftSettings
): PhonebankGapReportResult {
  const sorted = sortCalls(calls);
  const byPerson = new Map<string, PhonebankCallEvent[]>();
  for (const call of sorted) {
    const group = byPerson.get(call.phonebankerName) ?? [];
    group.push(call);
    byPerson.set(call.phonebankerName, group);
  }

  const phonebankerStats: PhonebankerDayStats[] = [];
  const gapDetails: PhonebankGapDetail[] = [];

  for (const [phonebankerName, group] of byPerson.entries()) {
    const positiveGaps: number[] = [];
    let largestGapMinutes = 0;
    let largestGapStartAt: string | null = null;
    let largestGapEndAt: string | null = null;
    let gapsAtOrAbove5 = 0;
    let gapsAtOrAbove15 = 0;
    let gapsAtOrAbove30 = 0;
    let gapsAtOrAbove60 = 0;
    let totalIdleMinutesAtOrAbove5 = 0;

    for (let i = 0; i < group.length - 1; i++) {
      const current = group[i]!;
      const next = group[i + 1]!;
      const prevEnd = DateTime.fromISO(current.endedAt);
      const nextDial = DateTime.fromISO(next.dialedAt);
      if (!prevEnd.isValid || !nextDial.isValid) continue;

      const rawMinutes = nextDial.diff(prevEnd, "minutes").minutes;
      if (!Number.isFinite(rawMinutes)) continue;

      const isOverlap = rawMinutes < 0;
      const gapMinutes = roundMinutes(Math.max(0, rawMinutes));
      positiveGaps.push(gapMinutes);

      if (gapMinutes > largestGapMinutes || (gapMinutes === largestGapMinutes && !largestGapStartAt)) {
        largestGapMinutes = gapMinutes;
        largestGapStartAt = current.endedAt;
        largestGapEndAt = next.dialedAt;
      }

      const overlapsLunch = gapOverlapsLunchWindow(
        current.endedAt,
        next.dialedAt,
        workDate,
        shiftSettings
      );
      const extendsPastLunchReturn = gapExtendsPastLunchReturn(
        current.endedAt,
        next.dialedAt,
        workDate,
        shiftSettings.lunchReturnTime
      );
      const overlapsPreLunchBreak = gapOverlapsScheduledBreak(
        current.endedAt,
        next.dialedAt,
        workDate,
        shiftSettings.preLunchBreakStart
      );
      const overlapsPostLunchBreak = gapOverlapsScheduledBreak(
        current.endedAt,
        next.dialedAt,
        workDate,
        shiftSettings.postLunchBreakStart
      );
      const { highlightLunchLong, highlightBreakLong } = classifyGapWindowHighlights({
        gapMinutes,
        extendsPastLunchReturn,
        overlapsPreLunchBreak,
        overlapsPostLunchBreak,
      });

      const detail: PhonebankGapDetail = {
        phonebankerName,
        startAt: current.endedAt,
        endAt: next.dialedAt,
        gapMinutes,
        isOverlap,
        overlapsLunch,
        overlapsPreLunchBreak,
        overlapsPostLunchBreak,
        highlightLunchLong,
        highlightBreakLong,
        gapAtOrAbove5: gapMinutes >= GAP_5,
        gapAtOrAbove15: gapMinutes >= GAP_15,
        gapAtOrAbove30: gapMinutes >= GAP_30,
        gapAtOrAbove60: gapMinutes >= GAP_60,
        endDisposition: next.disposition,
        endCallId: next.callId,
      };

      if (gapMinutes >= GAP_5 || isOverlap) {
        gapDetails.push(detail);
      }

      if (gapMinutes >= GAP_5) {
        gapsAtOrAbove5++;
        totalIdleMinutesAtOrAbove5 += gapMinutes;
      }
      if (gapMinutes >= GAP_15) gapsAtOrAbove15++;
      if (gapMinutes >= GAP_30) gapsAtOrAbove30++;
      if (gapMinutes >= GAP_60) gapsAtOrAbove60++;
    }

    const first = group[0]!;
    const last = group[group.length - 1]!;
    const firstDial = DateTime.fromISO(first.dialedAt);
    const lastEnd = DateTime.fromISO(last.endedAt);
    const spanMinutes =
      firstDial.isValid && lastEnd.isValid
        ? Math.max(0, roundMinutes(lastEnd.diff(firstDial, "minutes").minutes))
        : 0;
    const talkSeconds = group.reduce(
      (sum, call) => sum + (call.connected ? Math.max(0, call.durationSeconds) : 0),
      0
    );
    const talkMinutes = roundMinutes(talkSeconds / 60);
    const callsPerHour =
      spanMinutes > 0 ? Math.round((group.length / (spanMinutes / 60)) * 10) / 10 : group.length;

    phonebankerStats.push({
      phonebankerName,
      callCount: group.length,
      connectedCount: group.filter((c) => c.connected).length,
      firstDialAt: first.dialedAt,
      lastEndedAt: last.endedAt,
      spanMinutes,
      talkMinutes,
      callsPerHour,
      medianGapMinutes: median(positiveGaps),
      gapsAtOrAbove5,
      gapsAtOrAbove15,
      gapsAtOrAbove30,
      gapsAtOrAbove60,
      largestGapMinutes: roundMinutes(largestGapMinutes),
      largestGapStartAt,
      largestGapEndAt,
      totalIdleMinutesAtOrAbove5: roundMinutes(totalIdleMinutesAtOrAbove5),
    });
  }

  phonebankerStats.sort((a, b) => a.phonebankerName.localeCompare(b.phonebankerName));
  gapDetails.sort(
    (a, b) =>
      b.gapMinutes - a.gapMinutes ||
      a.phonebankerName.localeCompare(b.phonebankerName) ||
      a.startAt.localeCompare(b.startAt)
  );

  const shiftFlags = buildPhonebankShiftFlagRows(phonebankerStats, shiftSettings, workDate);

  const summary = {
    workDate,
    phonebankerCount: phonebankerStats.length,
    callCount: sorted.length,
    gapsAtOrAbove15: phonebankerStats.reduce((sum, row) => sum + row.gapsAtOrAbove15, 0),
    totalIdleMinutesAtOrAbove5: roundMinutes(
      phonebankerStats.reduce((sum, row) => sum + row.totalIdleMinutesAtOrAbove5, 0)
    ),
    largestGapMinutes: phonebankerStats.reduce(
      (max, row) => Math.max(max, row.largestGapMinutes),
      0
    ),
  };

  return {
    summary,
    phonebankerStats,
    gapDetails,
    calls: sorted,
    shiftFlags,
    shiftSettings,
  };
}
