import {
  buildKnockEvents,
  compareCanvasserNames,
  detectDistinctReportDates,
  detectReportDate,
  parseCanvassingUploadFile,
} from "../knock-details-parser";
import type { CanvassingKnockEvent, CanvassingParsedFile, CanvassingValidationIssue } from "../types";
import {
  addToHistogram,
  deriveStratumTag,
  emptyGapHistogram,
  eventIsoDate,
  gapSecondsBetween,
  isNonContactMobile,
  isSameHousehold,
  knocksPerHourFromSpan,
  modeStratumTag,
  voterLastName,
} from "./helpers";
import {
  DEFAULT_NON_CONTACT_PATTERN_SETTINGS,
  METRICS_SCHEMA_VERSION,
  MIN_NON_CONTACT_GAP_SAMPLE,
  SECOND_RESOLUTION_MIN_SHARE,
  type CanvasserMetricsSnapshot,
  type CanvasserPatternSummary,
  type EnrichedKnockRow,
  type NonContactPatternIngestionResult,
  type NonContactPatternResult,
  type NonContactPatternSettings,
  type ReportMetricsSnapshot,
  type TimestampResolution,
} from "./types";

function mergeSettings(partial?: Partial<NonContactPatternSettings>): NonContactPatternSettings {
  return {
    ...DEFAULT_NON_CONTACT_PATTERN_SETTINGS,
    ...partial,
  };
}

/**
 * Detect whether timestamps have usable second-level resolution.
 * If fewer than ~80% of timestamps have non-zero seconds OR all positive gaps
 * are whole minutes, treat as minute-resolution.
 */
export function detectTimestampResolution(events: CanvassingKnockEvent[]): {
  resolution: TimestampResolution;
  warning: string | null;
  shareWithNonZeroSeconds: number;
} {
  if (!events.length) {
    return {
      resolution: "minute",
      warning: "No knock events to analyze.",
      shareWithNonZeroSeconds: 0,
    };
  }

  let withSecondsField = 0;
  let withNonZeroSeconds = 0;
  for (const event of events) {
    const raw = event.dateTimeRaw;
    const hasSecondsPattern = /\d{1,2}:\d{2}:\d{2}/.test(raw) || /T\d{2}:\d{2}:\d{2}/.test(event.occurredAt);
    if (hasSecondsPattern) withSecondsField++;
    const second = Number(event.occurredAt.slice(17, 19));
    if (Number.isFinite(second) && second !== 0) withNonZeroSeconds++;
  }

  const shareWithSecondsField = withSecondsField / events.length;
  const shareWithNonZeroSeconds = withNonZeroSeconds / events.length;

  // Sample positive gaps — if all are multiples of 60s, likely minute-only data.
  const byCanvasser = new Map<string, CanvassingKnockEvent[]>();
  for (const event of events) {
    const group = byCanvasser.get(event.canvasserName) ?? [];
    group.push(event);
    byCanvasser.set(event.canvasserName, group);
  }
  let positiveGaps = 0;
  let wholeMinuteGaps = 0;
  for (const group of byCanvasser.values()) {
    const sorted = [...group].sort(
      (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceRowNumber - b.sourceRowNumber
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = gapSecondsBetween(sorted[i]!.occurredAt, sorted[i + 1]!.occurredAt);
      if (gap === null || gap <= 0) continue;
      positiveGaps++;
      if (Math.abs(gap % 60) < 0.001) wholeMinuteGaps++;
    }
  }
  const allGapsWholeMinutes = positiveGaps > 10 && wholeMinuteGaps / positiveGaps >= 0.98;

  const looksLikeSeconds =
    shareWithSecondsField >= SECOND_RESOLUTION_MIN_SHARE &&
    (shareWithNonZeroSeconds >= 0.05 || shareWithSecondsField >= 0.95) &&
    !allGapsWholeMinutes;

  if (!looksLikeSeconds) {
    return {
      resolution: "minute",
      warning:
        "Timestamps appear to be minute-level (or lack usable seconds). Use the existing Knock Analysis rapid-gap logic instead of second-level non-contact pattern detection.",
      shareWithNonZeroSeconds,
    };
  }

  return { resolution: "second", warning: null, shareWithNonZeroSeconds };
}

function enrichRows(
  events: CanvassingKnockEvent[],
  settings: NonContactPatternSettings
): EnrichedKnockRow[] {
  const byCanvasser = new Map<string, CanvassingKnockEvent[]>();
  for (const event of events) {
    const group = byCanvasser.get(event.canvasserName) ?? [];
    group.push(event);
    byCanvasser.set(event.canvasserName, group);
  }

  const enriched: EnrichedKnockRow[] = [];

  for (const [, group] of byCanvasser.entries()) {
    const sorted = [...group].sort(
      (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceRowNumber - b.sourceRowNumber
    );

    let prevStreak = 0;
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!;
      const next = i < sorted.length - 1 ? sorted[i + 1]! : null;
      const lastName = voterLastName(current.voter);
      const gapToNextSeconds = next ? gapSecondsBetween(current.occurredAt, next.occurredAt) : null;
      const sameHouseholdAsNext = next
        ? isSameHousehold(
            { ...current, lastName },
            { ...next, lastName: voterLastName(next.voter) }
          )
        : false;

      let rapidNonContactFlag = false;
      let rapidContactFlag = false;

      if (next && gapToNextSeconds !== null && gapToNextSeconds > 0) {
        const differentVoters = current.voter !== next.voter;
        if (
          isNonContactMobile(current.question) &&
          isNonContactMobile(next.question) &&
          differentVoters &&
          !sameHouseholdAsNext &&
          gapToNextSeconds <= settings.rapidNonContactMaxSeconds
        ) {
          rapidNonContactFlag = true;
        }

        if (
          !isNonContactMobile(current.question) &&
          !isNonContactMobile(next.question) &&
          differentVoters &&
          !sameHouseholdAsNext &&
          gapToNextSeconds <= settings.rapidContactMaxSeconds
        ) {
          rapidContactFlag = true;
        }
      }

      const streakLength = rapidNonContactFlag ? (prevStreak > 0 ? prevStreak + 1 : 1) : 0;
      prevStreak = streakLength;

      enriched.push({
        ...current,
        lastName,
        gapToNextSeconds,
        sameHouseholdAsNext,
        rapidNonContactFlag,
        streakLength,
        rapidContactFlag,
        isoDate: eventIsoDate(current.occurredAt),
      });
    }
  }

  enriched.sort(
    (a, b) =>
      compareCanvasserNames(a.canvasserName, b.canvasserName) ||
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.sourceRowNumber - b.sourceRowNumber
  );

  return enriched;
}

function buildCanvasserSummaries(
  enriched: EnrichedKnockRow[],
  settings: NonContactPatternSettings
): CanvasserPatternSummary[] {
  const byCanvasser = new Map<string, EnrichedKnockRow[]>();
  for (const row of enriched) {
    const group = byCanvasser.get(row.canvasserName) ?? [];
    group.push(row);
    byCanvasser.set(row.canvasserName, group);
  }

  const summaries: CanvasserPatternSummary[] = [];

  for (const [canvasserName, rows] of byCanvasser.entries()) {
    const nonContactRowCount = rows.filter((r) => isNonContactMobile(r.question)).length;
    const rapidNonContactCount = rows.filter((r) => r.rapidNonContactFlag).length;
    const rapidContactCount = rows.filter((r) => r.rapidContactFlag).length;
    const longestRapidNonContactStreak = rows.reduce((max, r) => Math.max(max, r.streakLength), 0);

    const gapHistogram = emptyGapHistogram();
    let nonContactGapCount = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const current = rows[i]!;
      const next = rows[i + 1]!;
      if (
        isNonContactMobile(current.question) &&
        isNonContactMobile(next.question) &&
        current.voter !== next.voter &&
        !current.sameHouseholdAsNext &&
        current.gapToNextSeconds !== null &&
        current.gapToNextSeconds > 0
      ) {
        nonContactGapCount++;
        addToHistogram(gapHistogram, current.gapToNextSeconds);
      }
    }

    const rateSampleInsufficient = nonContactGapCount < MIN_NON_CONTACT_GAP_SAMPLE;
    const rapidNonContactRate = rateSampleInsufficient
      ? null
      : nonContactGapCount > 0
        ? rapidNonContactCount / nonContactGapCount
        : 0;

    const firstKnockAt = rows[0]?.occurredAt ?? null;
    const lastKnockAt = rows[rows.length - 1]?.occurredAt ?? null;
    const stratumTag = modeStratumTag(rows.map((r) => deriveStratumTag(r.assignmentName)));

    summaries.push({
      canvasserName,
      totalRows: rows.length,
      nonContactRowCount,
      nonContactRate: rows.length > 0 ? nonContactRowCount / rows.length : 0,
      nonContactGapCount,
      rapidNonContactCount,
      rapidNonContactRate,
      rateSampleInsufficient,
      longestRapidNonContactStreak,
      rapidContactCount,
      streakAlert: longestRapidNonContactStreak >= settings.streakAlertMin,
      firstKnockAt,
      lastKnockAt,
      knocksPerHour: knocksPerHourFromSpan(firstKnockAt, lastKnockAt, rows.length),
      gapHistogram,
      stratumTag,
    });
  }

  summaries.sort(
    (a, b) =>
      b.rapidNonContactCount - a.rapidNonContactCount ||
      compareCanvasserNames(a.canvasserName, b.canvasserName)
  );

  return summaries;
}

function buildMetricsSnapshot(params: {
  reportDate: string;
  timestampResolution: TimestampResolution;
  sourceChecksum: string;
  summaries: CanvasserPatternSummary[];
}): ReportMetricsSnapshot {
  const teamGapHistogram = emptyGapHistogram();
  const canvassers: CanvasserMetricsSnapshot[] = params.summaries.map((s) => {
    for (const [bucket, count] of Object.entries(s.gapHistogram) as Array<
      [keyof typeof s.gapHistogram, number]
    >) {
      teamGapHistogram[bucket] += count;
    }
    return {
      canvasserName: s.canvasserName,
      nonContactRowCount: s.nonContactRowCount,
      nonContactGapCount: s.nonContactGapCount,
      rapidNonContactCount: s.rapidNonContactCount,
      rapidNonContactRate: s.rapidNonContactRate,
      longestStreak: s.longestRapidNonContactStreak,
      rapidContactCount: s.rapidContactCount,
      gapHistogram: { ...s.gapHistogram },
      knocksPerHour: s.knocksPerHour,
      stratumTag: s.stratumTag,
    };
  });

  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    reportDate: params.reportDate,
    analyzedAt: new Date().toISOString(),
    timestampResolution: params.timestampResolution,
    stratumTag: modeStratumTag(params.summaries.map((s) => s.stratumTag)),
    sourceChecksum: params.sourceChecksum,
    teamGapHistogram,
    canvassers,
  };
}

export function analyzeNonContactPatternEvents(
  events: CanvassingKnockEvent[],
  options?: {
    settings?: Partial<NonContactPatternSettings>;
    sourceFiles?: NonContactPatternResult["sourceFiles"];
    validationIssues?: CanvassingValidationIssue[];
    sourceChecksum?: string;
    forceReportDate?: string | null;
  }
): NonContactPatternResult {
  const settings = mergeSettings(options?.settings);
  const sourceFiles = options?.sourceFiles ?? [];
  const validationIssues = [...(options?.validationIssues ?? [])];
  const sourceChecksum =
    options?.sourceChecksum ??
    (sourceFiles.map((f) => f.checksum).sort().join("|") || "none");

  const resolution = detectTimestampResolution(events);
  if (resolution.warning) {
    validationIssues.push({
      severity: "warning",
      code: "minute_resolution",
      message: resolution.warning,
    });
  }

  const enrichedRows =
    resolution.resolution === "second" ? enrichRows(events, settings) : enrichRows(events, settings);
  // Always enrich for inspection, but flag resolution in summary so UI can warn.

  const canvasserSummaries = buildCanvasserSummaries(enrichedRows, settings);
  const flaggedNonContactRows = enrichedRows.filter((r) => r.rapidNonContactFlag);
  const flaggedContactRows = enrichedRows.filter((r) => r.rapidContactFlag);
  const distinctDates = detectDistinctReportDates(events);
  const detectedReportDate =
    options?.forceReportDate ?? detectReportDate(events) ?? distinctDates[0] ?? null;

  const metricsSnapshot =
    detectedReportDate && resolution.resolution === "second"
      ? buildMetricsSnapshot({
          reportDate: detectedReportDate,
          timestampResolution: resolution.resolution,
          sourceChecksum,
          summaries: canvasserSummaries,
        })
      : detectedReportDate
        ? buildMetricsSnapshot({
            reportDate: detectedReportDate,
            timestampResolution: resolution.resolution,
            sourceChecksum,
            summaries: canvasserSummaries,
          })
        : null;

  return {
    sourceFiles,
    summary: {
      detectedReportDate,
      distinctDates,
      timestampResolution: resolution.resolution,
      resolutionWarning: resolution.warning,
      totalRows: enrichedRows.length,
      totalCanvassers: canvasserSummaries.length,
      rapidNonContactFlagCount: flaggedNonContactRows.length,
      rapidContactFlagCount: flaggedContactRows.length,
      streakAlertCanvasserCount: canvasserSummaries.filter((s) => s.streakAlert).length,
      settings,
    },
    canvasserSummaries,
    enrichedRows,
    flaggedNonContactRows,
    flaggedContactRows,
    metricsSnapshot,
    validationIssues,
  };
}

export function analyzeNonContactPatternParsedFiles(
  parsedFiles: CanvassingParsedFile[],
  settings?: Partial<NonContactPatternSettings>
): NonContactPatternResult {
  const knock = buildKnockEvents(parsedFiles);
  const sourceFiles = parsedFiles.map((f) => f.sourceFile);
  const sourceChecksum = sourceFiles
    .map((f) => f.checksum)
    .sort()
    .join("|");
  return analyzeNonContactPatternEvents(knock.events, {
    settings,
    sourceFiles,
    validationIssues: knock.issues,
    sourceChecksum,
  });
}

/**
 * Date-aware ingestion: if the file spans multiple calendar dates, split into
 * one result per date (gap-fill uploads). Otherwise return a single result.
 */
export function analyzeNonContactPatternParsedFilesDateAware(
  parsedFiles: CanvassingParsedFile[],
  settings?: Partial<NonContactPatternSettings>
): NonContactPatternIngestionResult {
  const knock = buildKnockEvents(parsedFiles);
  const sourceFiles = parsedFiles.map((f) => f.sourceFile);
  const sourceChecksum = sourceFiles
    .map((f) => f.checksum)
    .sort()
    .join("|");
  const distinctDates = detectDistinctReportDates(knock.events);

  if (distinctDates.length <= 1) {
    const result = analyzeNonContactPatternEvents(knock.events, {
      settings,
      sourceFiles,
      validationIssues: knock.issues,
      sourceChecksum,
      forceReportDate: distinctDates[0] ?? null,
    });
    return { results: [result], splitByDate: false, distinctDates };
  }

  const results: NonContactPatternResult[] = [];
  for (const date of distinctDates) {
    const dayEvents = knock.events.filter((e) => eventIsoDate(e.occurredAt) === date);
    const dayChecksum = `${sourceChecksum}:${date}`;
    results.push(
      analyzeNonContactPatternEvents(dayEvents, {
        settings,
        sourceFiles,
        validationIssues: knock.issues.filter((issue) => {
          // Keep file-level issues once; row-level issues only if in day's rows.
          if (!issue.rowNumber) return date === distinctDates[0];
          return dayEvents.some((e) => e.sourceRowNumber === issue.rowNumber);
        }),
        sourceChecksum: dayChecksum,
        forceReportDate: date,
      })
    );
  }

  return { results, splitByDate: true, distinctDates };
}

export async function analyzeNonContactPatternUploads(
  files: Array<{ fileName: string; relativePath?: string; buffer: Buffer }>,
  settings?: Partial<NonContactPatternSettings>
): Promise<NonContactPatternIngestionResult> {
  const parsedGroups = await Promise.all(files.map((file) => parseCanvassingUploadFile(file)));
  return analyzeNonContactPatternParsedFilesDateAware(parsedGroups.flat(), settings);
}

/** Convenience: analyze a single buffer as one logical upload. */
export async function analyzeNonContactPatternFile(
  input: { fileName: string; relativePath?: string; buffer: Buffer },
  settings?: Partial<NonContactPatternSettings>
): Promise<NonContactPatternIngestionResult> {
  return analyzeNonContactPatternUploads([input], settings);
}
