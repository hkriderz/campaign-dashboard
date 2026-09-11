import type { TagDailyCallerStat } from "./types";

/** True if this campaign/day/banker has any signal beyond idle logged-in time. */
export function tagDailyCallerHasWorkBeyondLoggedHours(row: TagDailyCallerStat): boolean {
  return (
    row.callsAnswered > 0 ||
    row.talkingToCorrectPerson > 0 ||
    row.surveyed > 0 ||
    (row.strongSupport ?? 0) > 0 ||
    row.totalCallSeconds > 0 ||
    row.numDials > 0
  );
}

/**
 * Whether a View Detailed Stats session row should appear.
 * Logged-in hours and sub-minute call seconds alone are not work (table shows 0.00h).
 */
export function phonebankerDailyStatHasVisibleWork(row: {
  phonebankerName: string;
  numDials: number;
  totalCallHours: number;
  surveyed: number;
  strongSupport: number;
}): boolean {
  return (
    Boolean(row.phonebankerName.trim()) &&
    (row.numDials > 0 || row.totalCallHours > 0 || row.surveyed > 0 || row.strongSupport > 0)
  );
}
