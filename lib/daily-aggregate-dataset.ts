import { laCalendarYmd } from "./la-dates";
import { formatShortUsDate } from "./slice-key";

export type AggregateDatasetMode = "today" | "total" | "custom";

/** URL `view=total` means all-time; otherwise missing dates default to Pacific today. */
export function parseAggregateViewParam(raw: string | undefined | null): "total" | null {
  return raw?.trim().toLowerCase() === "total" ? "total" : null;
}

export function resolveAggregateDateRange(opts: {
  viewTotal: boolean;
  requestedStart: string;
  requestedEnd: string;
  todayYmd?: string;
}): { startDate: string; endDate: string; mode: AggregateDatasetMode } {
  const today = opts.todayYmd ?? laCalendarYmd();
  if (opts.viewTotal) {
    return { startDate: "", endDate: "", mode: "total" };
  }
  if (opts.requestedStart && opts.requestedEnd) {
    const mode: AggregateDatasetMode =
      opts.requestedStart === opts.requestedEnd && opts.requestedStart === today
        ? "today"
        : "custom";
    return { startDate: opts.requestedStart, endDate: opts.requestedEnd, mode };
  }
  return { startDate: today, endDate: today, mode: "today" };
}

/**
 * Bold dataset label for the Daily Aggregate card.
 * e.g. "Nithya Raman | Today (10/17/26)" or "All Campaigns | Total"
 */
export function formatAggregateDatasetTitle(
  entityLabel: string,
  opts: { startDate: string; endDate: string; mode?: AggregateDatasetMode; todayYmd?: string }
): string {
  const label = entityLabel.trim() || "Campaign";
  const today = opts.todayYmd ?? laCalendarYmd();
  const mode =
    opts.mode ??
    (opts.startDate && opts.endDate
      ? opts.startDate === opts.endDate && opts.startDate === today
        ? "today"
        : "custom"
      : "total");

  if (mode === "total" || !opts.startDate) {
    return `${label} | Total`;
  }
  if (mode === "today" || (opts.startDate === opts.endDate && opts.startDate === today)) {
    return `${label} | Today (${formatShortUsDate(opts.startDate)})`;
  }
  if (opts.startDate === opts.endDate) {
    return `${label} | ${formatShortUsDate(opts.startDate)}`;
  }
  return `${label} | ${formatShortUsDate(opts.startDate)} – ${formatShortUsDate(opts.endDate)}`;
}
