import ExcelJS from "exceljs";
import {
  buildShiftFlagRows,
  sortGaps,
  type KnockShiftSettings,
} from "./knock-report-view";
import type {
  CampaignResultSummary,
  CanvasserGapStats,
  CanvassingGapDetail,
  CanvassingReportResult,
  KnockAnalysisReportMode,
} from "./types";

export type KnockAnalysisWorkbookInput = {
  result: CanvassingReportResult;
  title: string;
  reportDate?: string;
  reportMode: KnockAnalysisReportMode;
  shiftSettings: KnockShiftSettings;
  customGapMinutes: number | null;
  excludedLeads: CanvasserGapStats[];
  shiftStats: CanvasserGapStats[];
};

type Cell = string | number | null | undefined;

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  const totalSeconds = Math.max(0, Math.round(value * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSheetDuration(minutes: number): string {
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(mins).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(value: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatGapClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatGapDetail(gap: CanvassingGapDetail): string {
  const mins = Math.round(gap.gapMinutes);
  const response = gap.endResponse.trim() || "n/a";
  return `(${formatGapClock(gap.startAt)}-${formatGapClock(gap.endAt)}, ${mins} mins, ends w/ ${response})`;
}

function canvasserLastNameSortKey(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex >= 0) {
    const last = trimmed.slice(0, commaIndex).trim();
    const first = trimmed.slice(commaIndex + 1).trim();
    return `${last} ${first}`.toLowerCase();
  }
  const parts = trimmed.split(/\s+/);
  const last = parts.at(-1) ?? trimmed;
  const first = parts.slice(0, -1).join(" ");
  return `${last} ${first}`.toLowerCase();
}

function compareCanvasserStats(a: CanvasserGapStats, b: CanvasserGapStats): number {
  return canvasserLastNameSortKey(a.canvasserName).localeCompare(canvasserLastNameSortKey(b.canvasserName));
}

function gapLengthTotalMinutes(stat: CanvasserGapStats): number {
  if (stat.totalGapMinutesOver10 > 0) return stat.totalGapMinutesOver10;
  return stat.largestGapMinutes;
}

function groupGapsChronologically(gaps: CanvassingGapDetail[]): Array<{ canvasserName: string; gaps: CanvassingGapDetail[] }> {
  const byName = new Map<string, CanvassingGapDetail[]>();
  for (const gap of gaps) {
    const group = byName.get(gap.canvasserName) ?? [];
    group.push(gap);
    byName.set(gap.canvasserName, group);
  }
  return [...byName.entries()]
    .map(([canvasserName, group]) => ({
      canvasserName,
      gaps: [...group].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.endAt.localeCompare(b.endAt)),
    }))
    .sort((a, b) => canvasserLastNameSortKey(a.canvasserName).localeCompare(canvasserLastNameSortKey(b.canvasserName)));
}

function uniqueSheetName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim() || "Sheet";
  const base = cleaned.slice(0, 31);
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${n}`;
    candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

const PIVOT_HEADERS = [
  "Canvasser",
  "Longest Gap",
  "Longest gap start",
  "Longest gap end",
  "First Knock",
  "Most recent knock",
  "Gap length total",
  "Average non zero gap",
  "average gap that ends in contact",
];

/** Fills for columns A–G. Columns H and I stay unshaded. */
const PIVOT_COLUMN_FILLS = [
  "FFC9DAF8",
  "FFC9DAF8",
  "FFC9DAF8",
  "FFC9DAF8",
  "FFD9EAD3",
  "FFFFF2CC",
  "FFFCE5CD",
  "",
  "",
];

const PIVOT_THIN_BORDER: ExcelJS.Border = { style: "thin", color: { argb: "FFD9D9D9" } };

function stylePivotSheet(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).height = 36;
  const lastRow = Math.max(sheet.rowCount, 1);
  for (let col = 1; col <= PIVOT_HEADERS.length; col += 1) {
    const fill = PIVOT_COLUMN_FILLS[col - 1] ?? "";
    const header = sheet.getRow(1).getCell(col);
    header.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF000000" } };
    header.alignment = { wrapText: true, vertical: "middle", horizontal: "left" };
    if (fill) {
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    }
    header.border = {
      top: PIVOT_THIN_BORDER,
      left: PIVOT_THIN_BORDER,
      bottom: PIVOT_THIN_BORDER,
      right: PIVOT_THIN_BORDER,
    };
    for (let row = 2; row <= lastRow; row += 1) {
      const cell = sheet.getRow(row).getCell(col);
      cell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
      cell.alignment = { vertical: "middle", horizontal: col === 1 ? "left" : "right" };
      if (fill) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      }
      cell.border = {
        top: PIVOT_THIN_BORDER,
        left: PIVOT_THIN_BORDER,
        bottom: PIVOT_THIN_BORDER,
        right: PIVOT_THIN_BORDER,
      };
    }
  }
  const widths = [24, 14, 14, 14, 14, 14, 14, 14, 16];
  sheet.columns.forEach((col, index) => {
    col.width = widths[index] ?? 14;
  });
}

function addSheet(workbook: ExcelJS.Workbook, used: Set<string>, name: string, headers: string[], rows: Cell[][]): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(uniqueSheetName(name, used));
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(row.map((cell) => (cell === null || cell === undefined ? "" : cell)));
  }
  sheet.columns.forEach((col, index) => {
    const header = headers[index] ?? "";
    col.width = Math.min(42, Math.max(12, header.length + 2));
  });
  return sheet;
}

function gapListRows(gaps: CanvassingGapDetail[]): Cell[][] {
  return sortGaps(gaps).map((gap) => [
    gap.canvasserName,
    formatDuration(gap.gapMinutes),
    formatTime(gap.startAt),
    formatTime(gap.endAt),
    gap.endVoter || "n/a",
    gap.endResponse || "n/a",
  ]);
}

const GAP_LIST_HEADERS = ["Canvasser", "Gap Length", "Start Time", "End Time", "End Voter", "End Response"];

function gapMatrixRows(gaps: CanvassingGapDetail[], mode: "length" | "detail"): { headers: string[]; rows: Cell[][] } {
  const grouped = groupGapsChronologically(gaps);
  const columnCount = grouped.reduce((max, row) => Math.max(max, row.gaps.length), 0);
  const gapHeaders = Array.from({ length: columnCount }, (_, index) => `Gap ${index + 1}`);
  const headers = mode === "length" ? ["Canvasser", "Total Gap Length", ...gapHeaders] : ["Canvasser", ...gapHeaders];
  const rows = grouped.map((row) => {
    const cells = row.gaps.map((gap) =>
      mode === "length" ? formatSheetDuration(gap.gapMinutes) : formatGapDetail(gap)
    );
    while (cells.length < columnCount) cells.push("");
    if (mode === "length") {
      const total = row.gaps.reduce((sum, gap) => sum + gap.gapMinutes, 0);
      return [row.canvasserName, formatSheetDuration(total), ...cells];
    }
    return [row.canvasserName, ...cells];
  });
  return { headers, rows };
}

function campaignRows(campaign: CampaignResultSummary): Cell[][] {
  const rows = campaign.canvassers.map((canvasser) => [
    canvasser.canvasserName,
    ...campaign.resultColumns.map((column) => canvasser.totals[column] ?? 0),
  ]);
  rows.push(["Total", ...campaign.resultColumns.map((column) => campaign.totals[column] ?? 0)]);
  return rows;
}

export async function buildKnockAnalysisWorkbook(input: KnockAnalysisWorkbookInput): Promise<Uint8Array> {
  const { result, reportMode, shiftSettings, customGapMinutes, excludedLeads, shiftStats } = input;
  const displayDate = input.reportDate || result.summary.detectedReportDate;
  const hourGaps = result.hourGapDetails ?? result.gapDetails.filter((gap) => gap.gapMinutes >= 60);
  const outlierGaps = result.outlierGapDetails ?? result.gapDetails.filter((gap) => gap.gapMinutes >= 120);
  const bigGaps = result.bigGapDetails ?? result.gapDetails.filter((gap) => gap.gapMinutes > 30);
  const customGaps =
    customGapMinutes === null ? [] : result.gapDetails.filter((gap) => gap.gapMinutes >= customGapMinutes);
  const shiftRows = buildShiftFlagRows(shiftStats, shiftSettings, displayDate || null);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "campaign-dashboard";
  workbook.created = new Date();
  const used = new Set<string>();

  const pivot = addSheet(
    workbook,
    used,
    "Pivot",
    PIVOT_HEADERS,
    [...result.canvasserStats].sort(compareCanvasserStats).map((stat) => [
      stat.canvasserName,
      formatDuration(stat.largestGapMinutes),
      formatTime(stat.largestGapStartAt),
      formatTime(stat.largestGapEndAt),
      formatTime(stat.firstKnockAt),
      formatTime(stat.mostRecentKnockAt),
      formatDuration(gapLengthTotalMinutes(stat)),
      formatDuration(stat.averageNonZeroGapMinutes),
      stat.averageGapEndingInContactMinutes === null ? "" : formatDuration(stat.averageGapEndingInContactMinutes),
    ])
  );
  stylePivotSheet(pivot);

  if (reportMode === "lunch") {
    addSheet(
      workbook,
      used,
      "Late first knocks",
      ["Canvasser", "First Knock", "Minutes after start", "Knocks"],
      shiftRows
        .filter((row) => row.isLateFirstKnock)
        .sort((a, b) => (b.minutesLateAfterStart ?? 0) - (a.minutesLateAfterStart ?? 0))
        .map((row) => [row.canvasserName, formatTime(row.firstKnockAt), row.minutesLateAfterStart ?? "", row.knockCount])
    );
    addSheet(
      workbook,
      used,
      "Still on lunch",
      ["Canvasser", "Last Knock", "Minutes before as-of", "Knocks"],
      shiftRows
        .filter((row) => row.isStillOnLunch)
        .sort((a, b) => (b.minutesBeforeAsOf ?? 0) - (a.minutesBeforeAsOf ?? 0))
        .map((row) => [
          row.canvasserName,
          formatTime(row.mostRecentKnockAt),
          row.minutesBeforeAsOf ?? "",
          row.knockCount,
        ])
    );
  } else {
    addSheet(
      workbook,
      used,
      "Stopped early",
      ["Canvasser", "Last Knock", "Minutes before end", "Knocks"],
      shiftRows
        .filter((row) => row.isStoppedEarly)
        .sort((a, b) => (b.minutesEarlyBeforeEnd ?? 0) - (a.minutesEarlyBeforeEnd ?? 0))
        .map((row) => [
          row.canvasserName,
          formatTime(row.mostRecentKnockAt),
          row.minutesEarlyBeforeEnd ?? "",
          row.knockCount,
        ])
    );
  }

  if (customGapMinutes !== null) {
    addSheet(workbook, used, `Gaps ${customGapMinutes}m+`, GAP_LIST_HEADERS, gapListRows(customGaps));
  }
  addSheet(workbook, used, "Gaps over 1 hour", GAP_LIST_HEADERS, gapListRows(hourGaps));
  addSheet(workbook, used, "Outliers 2h+", GAP_LIST_HEADERS, gapListRows(outlierGaps));

  const lengths = gapMatrixRows(result.gapDetails, "length");
  addSheet(workbook, used, "Gap lengths", lengths.headers, lengths.rows);
  const details = gapMatrixRows(result.gapDetails, "detail");
  addSheet(workbook, used, "Gap details", details.headers, details.rows);
  const big = gapMatrixRows(bigGaps, "detail");
  addSheet(workbook, used, "Big gap details", big.headers, big.rows);

  if (excludedLeads.length) {
    addSheet(
      workbook,
      used,
      "Excluded",
      ["Canvasser", "Knocks"],
      excludedLeads.map((lead) => [lead.canvasserName, lead.knockCount])
    );
  }

  for (const campaign of result.campaignResults) {
    addSheet(workbook, used, campaign.campaignName || "Campaign", ["Canvasser", ...campaign.resultColumns], campaignRows(campaign));
  }

  const raw = await workbook.xlsx.writeBuffer();
  return raw instanceof Uint8Array ? new Uint8Array(raw) : new Uint8Array(raw as ArrayBuffer);
}
