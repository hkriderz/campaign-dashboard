/**
 * Client-safe Knock Analysis view helpers (exclude matching + shift flags).
 * Pure module — no `server-only`.
 */
import { DateTime } from "luxon";
import type {
  CanvasserGapStats,
  CanvassingGapDetail,
  CanvassingReportResult,
  KnockAnalysisReportMode,
} from "./types";

const LA_TIME_ZONE = "America/Los_Angeles";

export const STOPPED_EARLY_MINUTES = 30;
/** First knock must be at least this many minutes after start to count as late. */
export const LATE_FIRST_KNOCK_GRACE_MINUTES = 30;

export type KnockShiftSettings = {
  mode: KnockAnalysisReportMode;
  /** HH:mm local LA wall-clock — canvasser shift start */
  startTime: string;
  /** HH:mm local LA wall-clock — expected lunch clock-out */
  lunchClockOutTime: string;
  /** HH:mm local LA wall-clock — expected lunch return / back knocking */
  lunchReturnTime: string;
  /** HH:mm local LA wall-clock — last door knock / shift end */
  endTime: string;
  /** HH:mm local LA wall-clock — report cutoff for still-on-lunch */
  asOfTime: string;
};

export type ShiftFlagRow = {
  canvasserName: string;
  knockCount: number;
  firstKnockAt: string | null;
  mostRecentKnockAt: string | null;
  minutesLateAfterStart: number | null;
  minutesEarlyBeforeEnd: number | null;
  minutesBeforeAsOf: number | null;
  isLateFirstKnock: boolean;
  isStillOnLunch: boolean;
  isStoppedEarly: boolean;
};

export function defaultShiftSettings(mode: KnockAnalysisReportMode): KnockShiftSettings {
  return {
    mode,
    startTime: "12:30",
    lunchClockOutTime: "15:30",
    lunchReturnTime: "16:00",
    endTime: "19:30",
    asOfTime: currentLaTimeHm(),
  };
}

export function currentLaTimeHm(): string {
  return DateTime.now().setZone(LA_TIME_ZONE).toFormat("HH:mm");
}

function normalizeNameText(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N},\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function nameTokens(value: string): string[] {
  const normalized = normalizeNameText(value).replace(/,/g, " ");
  return normalized.split(/\s+/).filter(Boolean);
}

export function nameMatchKeys(value: string): Set<string> {
  const tokens = nameTokens(value);
  const keys = new Set<string>();
  if (!tokens.length) return keys;

  keys.add(tokens.join(" "));
  keys.add([...tokens].sort().join(" "));

  const commaIndex = value.indexOf(",");
  if (commaIndex >= 0) {
    const last = value.slice(0, commaIndex).trim();
    const first = value.slice(commaIndex + 1).trim();
    const firstLastTokens = nameTokens(`${first} ${last}`);
    if (firstLastTokens.length) {
      keys.add(firstLastTokens.join(" "));
      keys.add([...firstLastTokens].sort().join(" "));
    }
  }

  return keys;
}

function splitExcludedCanvasserEntries(raw: string): string[] {
  const entries: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes(";")) {
      entries.push(...trimmed.split(";").map((item) => item.trim()).filter(Boolean));
      continue;
    }

    const commaParts = trimmed.split(",").map((item) => item.trim()).filter(Boolean);
    if (commaParts.length > 2 || commaParts.every((part) => nameTokens(part).length > 1)) {
      entries.push(...commaParts);
    } else {
      entries.push(trimmed);
    }
  }

  return entries;
}

export function parseExcludedCanvassers(raw: string): Set<string> {
  const keys = new Set<string>();
  for (const entry of splitExcludedCanvasserEntries(raw)) {
    for (const key of nameMatchKeys(entry)) keys.add(key);
  }
  return keys;
}

export function isExcludedCanvasser(name: string, excludedCanvassers: Set<string>): boolean {
  for (const key of nameMatchKeys(name)) {
    if (excludedCanvassers.has(key)) return true;
  }
  return false;
}

function combineDateAndTime(isoDate: string | null, hm: string): DateTime | null {
  if (!isoDate || !/^\d{2}:\d{2}$/.test(hm)) return null;
  const dt = DateTime.fromISO(`${isoDate}T${hm}:00`, { zone: LA_TIME_ZONE });
  return dt.isValid ? dt : null;
}

function reportIsoDate(result: CanvassingReportResult, overrideDate?: string): string | null {
  const raw = overrideDate || result.summary.detectedReportDate;
  if (!raw) return null;
  const dt = DateTime.fromISO(raw, { zone: LA_TIME_ZONE });
  return dt.isValid ? dt.toISODate() : raw.slice(0, 10);
}

export function buildShiftFlagRows(
  stats: CanvasserGapStats[],
  settings: KnockShiftSettings,
  reportDate: string | null
): ShiftFlagRow[] {
  const start = combineDateAndTime(reportDate, settings.startTime);
  const lunchReturn = combineDateAndTime(reportDate, settings.lunchReturnTime);
  const end = combineDateAndTime(reportDate, settings.endTime);
  const asOf = combineDateAndTime(reportDate, settings.asOfTime);

  return stats.map((stat) => {
    const first = stat.firstKnockAt ? DateTime.fromISO(stat.firstKnockAt) : null;
    const last = stat.mostRecentKnockAt ? DateTime.fromISO(stat.mostRecentKnockAt) : null;

    const minutesLateAfterStart =
      start && first && first.isValid ? Math.max(0, Math.round(first.diff(start, "minutes").minutes)) : null;
    const minutesEarlyBeforeEnd =
      end && last && last.isValid ? Math.max(0, Math.round(end.diff(last, "minutes").minutes)) : null;
    const minutesBeforeAsOf =
      asOf && last && last.isValid ? Math.max(0, Math.round(asOf.diff(last, "minutes").minutes)) : null;

    const isLateFirstKnock =
      minutesLateAfterStart !== null && minutesLateAfterStart >= LATE_FIRST_KNOCK_GRACE_MINUTES;

    // Not back from lunch: as-of is at/after expected return, and there is no knock at/after return.
    // lunchClockOutTime is the configured leave time shown in the UI for the lunch window.
    const isStillOnLunch = Boolean(
      asOf?.isValid && lunchReturn?.isValid && last?.isValid && asOf >= lunchReturn && last < lunchReturn
    );

    const isStoppedEarly =
      minutesEarlyBeforeEnd !== null && minutesEarlyBeforeEnd >= STOPPED_EARLY_MINUTES;

    return {
      canvasserName: stat.canvasserName,
      knockCount: stat.knockCount,
      firstKnockAt: stat.firstKnockAt,
      mostRecentKnockAt: stat.mostRecentKnockAt,
      minutesLateAfterStart: isLateFirstKnock ? minutesLateAfterStart : null,
      minutesEarlyBeforeEnd: isStoppedEarly ? minutesEarlyBeforeEnd : null,
      minutesBeforeAsOf: isStillOnLunch ? minutesBeforeAsOf : null,
      isLateFirstKnock,
      isStillOnLunch,
      isStoppedEarly,
    };
  });
}

/**
 * Filter gap / shift-flag report surfaces for excluded leads.
 * Knock Analysis pivot (`canvasserStats`) and campaign workbooks stay full-roster.
 */
export function filterKnockResultForReports(
  result: CanvassingReportResult | null,
  excludedCanvassers: Set<string>
): CanvassingReportResult | null {
  if (!result || excludedCanvassers.size === 0) return result;

  const keepName = (name: string) => !isExcludedCanvasser(name, excludedCanvassers);
  const gapDetails = result.gapDetails.filter((row) => keepName(row.canvasserName));
  const bigGapDetails = result.bigGapDetails.filter((row) => keepName(row.canvasserName));
  const hourGapDetails = (result.hourGapDetails ?? []).filter((row) => keepName(row.canvasserName));
  const outlierGapDetails = (result.outlierGapDetails ?? []).filter((row) => keepName(row.canvasserName));
  const includedStats = result.canvasserStats.filter((row) => keepName(row.canvasserName));
  const totalGapMinutesOver10 = includedStats.reduce((sum, row) => sum + row.totalGapMinutesOver10, 0);
  const largestGapMinutes = includedStats.reduce((max, row) => Math.max(max, row.largestGapMinutes), 0);

  return {
    ...result,
    // Full roster for pivot / productivity views.
    canvasserStats: result.canvasserStats,
    gapDetails,
    bigGapDetails,
    hourGapDetails,
    outlierGapDetails,
    campaignResults: result.campaignResults,
    summary: {
      ...result.summary,
      // Roster counts stay full; gap tiles reflect filtered gaps only.
      totalCanvassers: result.canvasserStats.length,
      validKnockEvents: result.canvasserStats.reduce((sum, row) => sum + row.knockCount, 0),
      gapsOver10: gapDetails.length,
      bigGapsOver30: bigGapDetails.length,
      gapsOver60: hourGapDetails.length,
      outlierGapsOver120: outlierGapDetails.length,
      totalGapMinutesOver10: Math.round(totalGapMinutesOver10 * 10) / 10,
      largestGapMinutes: Math.round(largestGapMinutes * 10) / 10,
    },
  };
}

/** Stats used for late-first / still-on-lunch / stopped-early (excludes leads). */
export function filterCanvasserStatsForFlags(
  stats: CanvasserGapStats[],
  excludedCanvassers: Set<string>
): CanvasserGapStats[] {
  if (!excludedCanvassers.size) return stats;
  return stats.filter((row) => !isExcludedCanvasser(row.canvasserName, excludedCanvassers));
}

export function excludedLeadRows(
  result: CanvassingReportResult | null,
  excludedCanvassers: Set<string>
): CanvasserGapStats[] {
  if (!result || excludedCanvassers.size === 0) return [];
  return result.canvasserStats.filter((row) => isExcludedCanvasser(row.canvasserName, excludedCanvassers));
}

export function resolveReportDate(result: CanvassingReportResult, overrideDate?: string): string | null {
  return reportIsoDate(result, overrideDate);
}

export function sortGaps(gaps: CanvassingGapDetail[]): CanvassingGapDetail[] {
  return [...gaps].sort(
    (a, b) => b.gapMinutes - a.gapMinutes || a.canvasserName.localeCompare(b.canvasserName)
  );
}
