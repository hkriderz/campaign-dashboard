import { DateTime } from "luxon";

const LA = "America/Los_Angeles";

/** Calendar YYYY-MM-DD in Los Angeles for instant `d` (default: now). */
export function laCalendarYmd(d: Date = new Date()): string {
  return DateTime.fromJSDate(d, { zone: LA }).toFormat("yyyy-MM-dd");
}

/** Yesterday's calendar date in Los Angeles. */
export function laYesterdayYmd(d: Date = new Date()): string {
  return DateTime.fromJSDate(d, { zone: LA }).minus({ days: 1 }).toFormat("yyyy-MM-dd");
}
