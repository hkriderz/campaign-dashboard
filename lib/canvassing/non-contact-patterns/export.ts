import ExcelJS from "exceljs";
import type { BaselineComparison } from "./types";
import type { NonContactPatternResult } from "./types";
import { GAP_HISTOGRAM_BUCKETS } from "./types";

function sheetFromRows(workbook: ExcelJS.Workbook, name: string, headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>): void {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row.map((cell) => (cell === null || cell === undefined ? "" : cell)));
  }
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col) => {
    col.width = Math.min(36, Math.max(12, (col.header?.toString().length ?? 12) + 2));
  });
}

export async function buildNonContactPatternWorkbook(
  result: NonContactPatternResult,
  baselineComparison?: BaselineComparison | null
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "campaign-dashboard";
  workbook.created = new Date();

  sheetFromRows(
    workbook,
    "Canvasser Summary",
    [
      "Canvasser",
      "Total Rows",
      "Non-Contact Rows",
      "Non-Contact Rate",
      "Non-Contact Gaps",
      "Rapid Non-Contact Count",
      "Rapid Non-Contact Rate",
      "Longest Streak",
      "Streak Alert",
      "Burst Max",
      "Burst Alert",
      "Response Uniformity %",
      "Rapid Contact Count",
      "Knocks/Hour",
      "Stratum",
    ],
    result.canvasserSummaries.map((s) => [
      s.canvasserName,
      s.totalRows,
      s.nonContactRowCount,
      Number((s.nonContactRate * 100).toFixed(1)),
      s.nonContactGapCount,
      s.rapidNonContactCount,
      s.rateSampleInsufficient
        ? "insufficient sample"
        : s.rapidNonContactRate === null
          ? ""
          : Number((s.rapidNonContactRate * 100).toFixed(1)),
      s.longestRapidNonContactStreak,
      s.streakAlert,
      s.maxBurstCount,
      s.burstAlert,
      s.dominantRapidResponseShare === null
        ? ""
        : Number((s.dominantRapidResponseShare * 100).toFixed(1)),
      s.rapidContactCount,
      s.knocksPerHour === null ? "" : Number(s.knocksPerHour.toFixed(1)),
      s.stratumTag,
    ])
  );

  sheetFromRows(
    workbook,
    "Flagged Non-Contact",
    [
      "Canvasser",
      "Voter",
      "Next implied gap (s)",
      "Streak",
      "In Burst",
      "Datetime",
      "Phone",
      "Assignment",
      "Response",
      "Source Row",
    ],
    result.flaggedNonContactRows.map((r) => [
      r.canvasserName,
      r.voter,
      r.gapToNextSeconds === null ? "" : Number(r.gapToNextSeconds.toFixed(1)),
      r.streakLength,
      r.inBurstFlag,
      r.dateTimeRaw,
      r.phone,
      r.assignmentName,
      r.response,
      r.sourceRowNumber,
    ])
  );

  sheetFromRows(
    workbook,
    "Flagged Contact",
    [
      "Canvasser",
      "Voter",
      "Gap to next (s)",
      "Datetime",
      "Phone",
      "Assignment",
      "Question",
      "Response",
      "Source Row",
    ],
    result.flaggedContactRows.map((r) => [
      r.canvasserName,
      r.voter,
      r.gapToNextSeconds === null ? "" : Number(r.gapToNextSeconds.toFixed(1)),
      r.dateTimeRaw,
      r.phone,
      r.assignmentName,
      r.question,
      r.response,
      r.sourceRowNumber,
    ])
  );

  sheetFromRows(
    workbook,
    "Canvasser Details",
    [
      "Canvasser",
      "Voter",
      "Last Name",
      "Datetime",
      "Gap to Next (s)",
      "Household Match",
      "Same Household As Next",
      "Rapid Non-Contact",
      "Streak",
      "In Burst",
      "Rapid Contact",
      "Question",
      "Response",
      "Phone",
      "Assignment",
      "Source Row",
    ],
    result.enrichedRows.map((r) => [
      r.canvasserName,
      r.voter,
      r.lastName,
      r.dateTimeRaw,
      r.gapToNextSeconds === null ? "" : Number(r.gapToNextSeconds.toFixed(1)),
      r.householdMatchKind,
      r.sameHouseholdAsNext,
      r.rapidNonContactFlag,
      r.streakLength,
      r.inBurstFlag,
      r.rapidContactFlag,
      r.question,
      r.response,
      r.phone,
      r.assignmentName,
      r.sourceRowNumber,
    ])
  );

  if (baselineComparison) {
    const scoreByName = new Map(
      baselineComparison.canvasserScores.map((s) => [s.canvasserName, s])
    );
    const b = baselineComparison.baseline;

    sheetFromRows(
      workbook,
      "Baseline Comparison",
      [
        "Canvasser",
        "Rapid Count",
        "Rapid Rate %",
        "0-15s Share %",
        "Longest Streak",
        "Burst Max",
        "Anomaly Tier",
        "Composite Score",
        "Team Median Rate %",
        "Team P95 Rate %",
        "Personal 7d Median %",
        "Team P95 0-15s Share %",
        "Signals",
      ],
      result.canvasserSummaries.map((s) => {
        const score = scoreByName.get(s.canvasserName);
        return [
          s.canvasserName,
          s.rapidNonContactCount,
          s.rapidNonContactRate === null ? "insufficient sample" : Number((s.rapidNonContactRate * 100).toFixed(1)),
          score?.rapidBucketShare0to15 === null || score?.rapidBucketShare0to15 === undefined
            ? ""
            : Number((score.rapidBucketShare0to15 * 100).toFixed(1)),
          s.longestRapidNonContactStreak,
          s.maxBurstCount,
          score?.anomalyTier ?? "",
          score?.compositeScore ?? "",
          b.medianRapidRate === null ? "" : Number((b.medianRapidRate * 100).toFixed(1)),
          b.p95RapidRate === null ? "" : Number((b.p95RapidRate * 100).toFixed(1)),
          score?.personalRapidRateMedian === null || score?.personalRapidRateMedian === undefined
            ? ""
            : Number((score.personalRapidRateMedian * 100).toFixed(1)),
          b.p95RapidBucketShare0to15 === null
            ? ""
            : Number((b.p95RapidBucketShare0to15 * 100).toFixed(1)),
          score?.signals.join("; ") ?? "",
        ];
      })
    );

    // Team histogram appendix rows
    const histSheet = workbook.addWorksheet("Team Histogram");
    histSheet.addRow(["Bucket", "Count", "Share %"]);
    histSheet.getRow(1).font = { bold: true };
    for (const bucket of GAP_HISTOGRAM_BUCKETS) {
      histSheet.addRow([
        bucket,
        b.teamGapHistogram[bucket],
        Number(((b.teamGapHistogramPct[bucket] ?? 0) * 100).toFixed(1)),
      ]);
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function resultToCsvBundle(result: NonContactPatternResult): string {
  const lines: string[] = [];
  lines.push("=== Canvasser Summary ===");
  lines.push(
    [
      "Canvasser",
      "TotalRows",
      "NonContactRows",
      "RapidNC",
      "LongestStreak",
      "BurstMax",
      "BurstAlert",
      "RapidContact",
      "RateOrNote",
    ].join(",")
  );
  for (const s of result.canvasserSummaries) {
    const rate = s.rateSampleInsufficient
      ? "insufficient sample"
      : s.rapidNonContactRate === null
        ? ""
        : (s.rapidNonContactRate * 100).toFixed(1);
    lines.push(
      [
        csvEscape(s.canvasserName),
        s.totalRows,
        s.nonContactRowCount,
        s.rapidNonContactCount,
        s.longestRapidNonContactStreak,
        s.maxBurstCount,
        s.burstAlert,
        s.rapidContactCount,
        csvEscape(rate),
      ].join(",")
    );
  }
  lines.push("");
  lines.push("=== Flagged Non-Contact ===");
  lines.push("Canvasser,Voter,GapSeconds,Streak,InBurst,Datetime");
  for (const r of result.flaggedNonContactRows) {
    lines.push(
      [
        csvEscape(r.canvasserName),
        csvEscape(r.voter),
        r.gapToNextSeconds ?? "",
        r.streakLength,
        r.inBurstFlag,
        csvEscape(r.dateTimeRaw),
      ].join(",")
    );
  }
  return lines.join("\r\n");
}

function csvEscape(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
