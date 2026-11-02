/** Shift clocks for phonebank gap reports (Pacific wall clock HH:mm). */
export type PhonebankGapShiftSettings = {
  startTime: string;
  lunchClockOutTime: string;
  lunchReturnTime: string;
  endTime: string;
  /** Start of the 10-minute break window before lunch. */
  preLunchBreakStart: string;
  /** Start of the 10-minute break window after lunch. */
  postLunchBreakStart: string;
  /** Cutoff for still-on-lunch; always current Pacific on load, never a system default. */
  asOfTime: string;
};

export type PhonebankCallEvent = {
  callId: string;
  phonebankerName: string;
  campaignId: string;
  campaignName: string;
  /** Pacific calendar date of calls.created_at (YYYY-MM-DD). */
  workDate: string;
  /** ISO instant for dial / call-row start (created_at in LA). */
  dialedAt: string;
  /** ISO instant when connected, or null. */
  connectedAt: string | null;
  /** ISO instant for call end (ended_at or connected_at + duration). */
  endedAt: string;
  durationSeconds: number;
  connected: boolean;
  disposition: string;
  telephonyStatus: string;
};

export type PhonebankGapDetail = {
  phonebankerName: string;
  startAt: string;
  endAt: string;
  gapMinutes: number;
  isOverlap: boolean;
  overlapsLunch: boolean;
  overlapsPreLunchBreak: boolean;
  overlapsPostLunchBreak: boolean;
  /** Gap starts before lunch return and ends after it (lunch ran past return). */
  highlightLunchLong: boolean;
  /** Pre/post lunch break-window gap longer than 18 minutes. */
  highlightBreakLong: boolean;
  gapAtOrAbove5: boolean;
  gapAtOrAbove15: boolean;
  gapAtOrAbove30: boolean;
  gapAtOrAbove60: boolean;
  endDisposition: string;
  endCallId: string;
};

export type PhonebankerDayStats = {
  phonebankerName: string;
  callCount: number;
  connectedCount: number;
  firstDialAt: string | null;
  lastEndedAt: string | null;
  spanMinutes: number;
  talkMinutes: number;
  callsPerHour: number;
  medianGapMinutes: number | null;
  gapsAtOrAbove5: number;
  gapsAtOrAbove15: number;
  gapsAtOrAbove30: number;
  gapsAtOrAbove60: number;
  largestGapMinutes: number;
  largestGapStartAt: string | null;
  largestGapEndAt: string | null;
  totalIdleMinutesAtOrAbove5: number;
};

export type PhonebankShiftFlagRow = {
  phonebankerName: string;
  callCount: number;
  firstDialAt: string | null;
  lastEndedAt: string | null;
  minutesLateAfterStart: number | null;
  minutesEarlyBeforeEnd: number | null;
  minutesBeforeAsOf: number | null;
  isLateFirstCall: boolean;
  isStillOnLunch: boolean;
  isStoppedEarly: boolean;
};

export type PhonebankGapReportSummary = {
  workDate: string;
  phonebankerCount: number;
  callCount: number;
  gapsAtOrAbove15: number;
  totalIdleMinutesAtOrAbove5: number;
  largestGapMinutes: number;
};

export type PhonebankGapReportResult = {
  summary: PhonebankGapReportSummary;
  phonebankerStats: PhonebankerDayStats[];
  gapDetails: PhonebankGapDetail[];
  calls: PhonebankCallEvent[];
  shiftFlags: PhonebankShiftFlagRow[];
  shiftSettings: PhonebankGapShiftSettings;
};
