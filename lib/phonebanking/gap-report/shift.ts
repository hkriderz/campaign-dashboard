import { DateTime } from "luxon";
import type {
  PhonebankGapShiftSettings,
  PhonebankShiftFlagRow,
  PhonebankerDayStats,
} from "./types";

const LA_TIME_ZONE = "America/Los_Angeles";

export const STOPPED_EARLY_MINUTES = 30;
export const LATE_FIRST_CALL_GRACE_MINUTES = 30;
/** Scheduled break length in minutes (pre- and post-lunch). */
export const SCHEDULED_BREAK_MINUTES = 10;
/** Highlight scheduled-break gaps strictly longer than this many minutes. */
export const BREAK_LONG_GAP_MINUTES = 18;

export function currentLaTimeHm(): string {
  return DateTime.now().setZone(LA_TIME_ZONE).toFormat("HH:mm");
}

/** Built-in seed for phonebank gaps (independent of knock system defaults). */
export function builtInPhonebankGapShiftSettings(): PhonebankGapShiftSettings {
  return {
    startTime: "12:30",
    lunchClockOutTime: "15:30",
    lunchReturnTime: "16:00",
    endTime: "19:30",
    preLunchBreakStart: "15:00",
    postLunchBreakStart: "16:30",
    asOfTime: currentLaTimeHm(),
  };
}

function combineDateAndTime(isoDate: string | null, hm: string): DateTime | null {
  if (!isoDate || !/^\d{2}:\d{2}$/.test(hm)) return null;
  const dt = DateTime.fromISO(`${isoDate}T${hm}:00`, { zone: LA_TIME_ZONE });
  return dt.isValid ? dt : null;
}

export function buildPhonebankShiftFlagRows(
  stats: PhonebankerDayStats[],
  settings: PhonebankGapShiftSettings,
  workDate: string
): PhonebankShiftFlagRow[] {
  const start = combineDateAndTime(workDate, settings.startTime);
  const lunchReturn = combineDateAndTime(workDate, settings.lunchReturnTime);
  const end = combineDateAndTime(workDate, settings.endTime);
  const asOf = combineDateAndTime(workDate, settings.asOfTime);

  return stats.map((stat) => {
    const first = stat.firstDialAt ? DateTime.fromISO(stat.firstDialAt) : null;
    const last = stat.lastEndedAt ? DateTime.fromISO(stat.lastEndedAt) : null;

    const minutesLateAfterStart =
      start && first?.isValid ? Math.max(0, Math.round(first.diff(start, "minutes").minutes)) : null;
    const minutesEarlyBeforeEnd =
      end && last?.isValid ? Math.max(0, Math.round(end.diff(last, "minutes").minutes)) : null;
    const minutesBeforeAsOf =
      asOf && last?.isValid ? Math.max(0, Math.round(asOf.diff(last, "minutes").minutes)) : null;

    const isLateFirstCall =
      minutesLateAfterStart !== null && minutesLateAfterStart >= LATE_FIRST_CALL_GRACE_MINUTES;

    const isStillOnLunch = Boolean(
      asOf?.isValid && lunchReturn?.isValid && last?.isValid && asOf >= lunchReturn && last < lunchReturn
    );

    const isStoppedEarly =
      minutesEarlyBeforeEnd !== null && minutesEarlyBeforeEnd >= STOPPED_EARLY_MINUTES;

    return {
      phonebankerName: stat.phonebankerName,
      callCount: stat.callCount,
      firstDialAt: stat.firstDialAt,
      lastEndedAt: stat.lastEndedAt,
      minutesLateAfterStart: isLateFirstCall ? minutesLateAfterStart : null,
      minutesEarlyBeforeEnd: isStoppedEarly ? minutesEarlyBeforeEnd : null,
      minutesBeforeAsOf: isStillOnLunch ? minutesBeforeAsOf : null,
      isLateFirstCall,
      isStillOnLunch,
      isStoppedEarly,
    };
  });
}

function gapOverlapsWindow(
  gapStartIso: string,
  gapEndIso: string,
  windowStart: DateTime | null,
  windowEnd: DateTime | null
): boolean {
  const gapStart = DateTime.fromISO(gapStartIso);
  const gapEnd = DateTime.fromISO(gapEndIso);
  if (!windowStart?.isValid || !windowEnd?.isValid || !gapStart.isValid || !gapEnd.isValid) {
    return false;
  }
  return gapStart < windowEnd && gapEnd > windowStart;
}

/** True when a gap interval overlaps the configured lunch window on the work date. */
export function gapOverlapsLunchWindow(
  gapStartIso: string,
  gapEndIso: string,
  workDate: string,
  settings: Pick<PhonebankGapShiftSettings, "lunchClockOutTime" | "lunchReturnTime">
): boolean {
  const lunchStart = combineDateAndTime(workDate, settings.lunchClockOutTime);
  const lunchEnd = combineDateAndTime(workDate, settings.lunchReturnTime);
  return gapOverlapsWindow(gapStartIso, gapEndIso, lunchStart, lunchEnd);
}

/** 10-minute break window starting at `breakStartHm`. */
export function gapOverlapsScheduledBreak(
  gapStartIso: string,
  gapEndIso: string,
  workDate: string,
  breakStartHm: string
): boolean {
  const breakStart = combineDateAndTime(workDate, breakStartHm);
  if (!breakStart) return false;
  const breakEnd = breakStart.plus({ minutes: SCHEDULED_BREAK_MINUTES });
  return gapOverlapsWindow(gapStartIso, gapEndIso, breakStart, breakEnd);
}

/**
 * Lunch highlight: the idle span starts before lunch return and ends after it
 * (lunch ran past the return clock). Not based on absolute gap length alone.
 */
export function gapExtendsPastLunchReturn(
  gapStartIso: string,
  gapEndIso: string,
  workDate: string,
  lunchReturnTime: string
): boolean {
  const lunchReturn = combineDateAndTime(workDate, lunchReturnTime);
  const gapStart = DateTime.fromISO(gapStartIso);
  const gapEnd = DateTime.fromISO(gapEndIso);
  if (!lunchReturn?.isValid || !gapStart.isValid || !gapEnd.isValid) return false;
  return gapStart < lunchReturn && gapEnd > lunchReturn;
}

export function classifyGapWindowHighlights(options: {
  gapMinutes: number;
  extendsPastLunchReturn: boolean;
  overlapsPreLunchBreak: boolean;
  overlapsPostLunchBreak: boolean;
}): { highlightLunchLong: boolean; highlightBreakLong: boolean } {
  const {
    gapMinutes,
    extendsPastLunchReturn,
    overlapsPreLunchBreak,
    overlapsPostLunchBreak,
  } = options;
  return {
    highlightLunchLong: extendsPastLunchReturn,
    highlightBreakLong:
      (overlapsPreLunchBreak || overlapsPostLunchBreak) && gapMinutes > BREAK_LONG_GAP_MINUTES,
  };
}
