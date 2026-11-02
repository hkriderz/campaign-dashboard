import type { DoorknockSummarySettings } from "@/lib/canvassing/doorknocks-results/types";

export const REPORT_DEFAULT_KINDS = [
  "knock-analysis",
  "doorknocks-results",
  "phonebank-gaps",
] as const;

export type ReportDefaultKind = (typeof REPORT_DEFAULT_KINDS)[number];

export type KnockAnalysisSystemDefaults = {
  startTime: string;
  lunchClockOutTime: string;
  lunchReturnTime: string;
  endTime: string;
  customGapMinutes?: number | null;
};

export type PhonebankGapsSystemDefaults = {
  startTime: string;
  lunchClockOutTime: string;
  lunchReturnTime: string;
  endTime: string;
  preLunchBreakStart: string;
  postLunchBreakStart: string;
};

export type DoorknocksResultsSystemDefaults = DoorknockSummarySettings;

export type ReportDefaultSettingsByKind = {
  "knock-analysis": KnockAnalysisSystemDefaults;
  "doorknocks-results": DoorknocksResultsSystemDefaults;
  "phonebank-gaps": PhonebankGapsSystemDefaults;
};

export type ReportDefaultsResponse<K extends ReportDefaultKind = ReportDefaultKind> = {
  kind: K;
  source: "system" | "built-in";
  settings: ReportDefaultSettingsByKind[K];
};

export function isReportDefaultKind(value: string): value is ReportDefaultKind {
  return (REPORT_DEFAULT_KINDS as readonly string[]).includes(value);
}
