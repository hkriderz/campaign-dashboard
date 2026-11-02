import ExcelJS from "exceljs";
import {
  formatDurationMinutes,
  formatLaDateTime,
  formatLaTime,
  gapNote,
  groupGapsChronologically,
} from "./copy-export";
import type {
  PhonebankCallEvent,
  PhonebankGapDetail,
  PhonebankGapReportResult,
  PhonebankGapShiftSettings,
  PhonebankShiftFlagRow,
  PhonebankerDayStats,
} from "./types";

type Cell = string | number | null | undefined;

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

function addSheet(
  workbook: ExcelJS.Workbook,
  used: Set<string>,
  name: string,
  headers: string[],
  rows: Cell[][]
): ExcelJS.Worksheet {
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

export type PhonebankGapWorkbookInput = {
  result: PhonebankGapReportResult;
  title: string;
  shiftSettings: PhonebankGapShiftSettings;
};

function pivotRows(stats: PhonebankerDayStats[]): Cell[][] {
  return stats.map((row) => [
    row.phonebankerName,
    row.callCount,
    row.connectedCount,
    formatLaTime(row.firstDialAt),
    formatLaTime(row.lastEndedAt),
    formatDurationMinutes(row.spanMinutes),
    formatDurationMinutes(row.talkMinutes),
    row.callsPerHour,
    row.medianGapMinutes == null ? "" : formatDurationMinutes(row.medianGapMinutes),
    row.gapsAtOrAbove5,
    row.gapsAtOrAbove15,
    row.gapsAtOrAbove30,
    formatDurationMinutes(row.largestGapMinutes),
    formatLaTime(row.largestGapStartAt),
    formatLaTime(row.largestGapEndAt),
    formatDurationMinutes(row.totalIdleMinutesAtOrAbove5),
  ]);
}

function gapListRows(gaps: PhonebankGapDetail[]): Cell[][] {
  return gaps
    .filter((g) => g.gapMinutes > 0)
    .map((gap) => [
      gap.phonebankerName,
      formatDurationMinutes(gap.gapMinutes),
      formatLaTime(gap.startAt),
      formatLaTime(gap.endAt),
      gapNote(gap),
    ]);
}

function matrixRows(gaps: PhonebankGapDetail[]): { headers: string[]; rows: Cell[][] } {
  const grouped = groupGapsChronologically(gaps.filter((g) => g.gapAtOrAbove5));
  const columnCount = grouped.reduce((max, row) => Math.max(max, row.gaps.length), 0);
  const gapHeaders = Array.from({ length: columnCount }, (_, index) => `Gap ${index + 1}`);
  const headers = ["Phonebanker", "Total ≥5m", ...gapHeaders];
  const rows = grouped.map((row) => {
    const cells = row.gaps.map(
      (gap) =>
        `${formatDurationMinutes(gap.gapMinutes)} (${formatLaTime(gap.startAt)}-${formatLaTime(gap.endAt)})`
    );
    while (cells.length < columnCount) cells.push("");
    const total = row.gaps.reduce((sum, g) => sum + (g.gapAtOrAbove5 ? g.gapMinutes : 0), 0);
    return [row.phonebankerName, formatDurationMinutes(total), ...cells];
  });
  return { headers, rows };
}

function timelineRows(calls: PhonebankCallEvent[]): Cell[][] {
  const byPerson = new Map<string, PhonebankCallEvent[]>();
  for (const call of calls) {
    const list = byPerson.get(call.phonebankerName) ?? [];
    list.push(call);
    byPerson.set(call.phonebankerName, list);
  }
  const rows: Cell[][] = [];
  for (const [name, personCalls] of [...byPerson.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    personCalls.forEach((call, index) => {
      const prev = index > 0 ? personCalls[index - 1] : null;
      let gapLabel = "First call";
      if (prev) {
        const startMs = Date.parse(prev.endedAt);
        const endMs = Date.parse(call.dialedAt);
        if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
          const mins = (endMs - startMs) / 60000;
          gapLabel =
            mins < 0
              ? `overlap ${formatDurationMinutes(Math.abs(mins))}`
              : formatDurationMinutes(mins);
        }
      }
      rows.push([
        name,
        index + 1,
        formatLaDateTime(call.dialedAt),
        formatLaTime(call.connectedAt),
        formatLaTime(call.endedAt),
        Math.round(call.durationSeconds),
        gapLabel,
        call.disposition,
        call.campaignName,
        call.callId,
      ]);
    });
  }
  return rows;
}

function flagRows(
  flags: PhonebankShiftFlagRow[],
  kind: "late" | "lunch" | "early"
): Cell[][] {
  if (kind === "late") {
    return flags
      .filter((r) => r.isLateFirstCall)
      .map((r) => [
        r.phonebankerName,
        formatLaTime(r.firstDialAt),
        r.minutesLateAfterStart ?? "",
        r.callCount,
      ]);
  }
  if (kind === "lunch") {
    return flags
      .filter((r) => r.isStillOnLunch)
      .map((r) => [
        r.phonebankerName,
        formatLaTime(r.lastEndedAt),
        r.minutesBeforeAsOf ?? "",
        r.callCount,
      ]);
  }
  return flags
    .filter((r) => r.isStoppedEarly)
    .map((r) => [
      r.phonebankerName,
      formatLaTime(r.lastEndedAt),
      r.minutesEarlyBeforeEnd ?? "",
      r.callCount,
    ]);
}

export async function buildPhonebankGapWorkbook(
  input: PhonebankGapWorkbookInput
): Promise<ArrayBuffer> {
  const { result, title, shiftSettings } = input;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "campaign-dashboard";
  workbook.created = new Date();
  const used = new Set<string>();

  addSheet(workbook, used, "Summary", ["Field", "Value"], [
    ["Title", title],
    ["Work date", result.summary.workDate],
    ["Start", shiftSettings.startTime],
    ["Lunch out", shiftSettings.lunchClockOutTime],
    ["Lunch return", shiftSettings.lunchReturnTime],
    ["End", shiftSettings.endTime],
    ["Pre-lunch break start", shiftSettings.preLunchBreakStart],
    ["Post-lunch break start", shiftSettings.postLunchBreakStart],
    ["As-of", shiftSettings.asOfTime],
    ["Phonebankers", result.summary.phonebankerCount],
    ["Calls", result.summary.callCount],
    ["Gaps ≥15m", result.summary.gapsAtOrAbove15],
    ["Idle ≥5m", formatDurationMinutes(result.summary.totalIdleMinutesAtOrAbove5)],
    ["Largest gap", formatDurationMinutes(result.summary.largestGapMinutes)],
  ]);

  addSheet(
    workbook,
    used,
    "By person",
    [
      "Phonebanker",
      "Calls",
      "Connected",
      "First dial",
      "Last end",
      "Span",
      "Talk",
      "Calls/hour",
      "Median gap",
      "Gaps ≥5",
      "Gaps ≥15",
      "Gaps ≥30",
      "Longest gap",
      "Longest start",
      "Longest end",
      "Idle ≥5m",
    ],
    pivotRows(result.phonebankerStats)
  );

  addSheet(
    workbook,
    used,
    "Late first call",
    ["Phonebanker", "First dial", "Minutes late", "Calls"],
    flagRows(result.shiftFlags, "late")
  );
  addSheet(
    workbook,
    used,
    "Still on lunch",
    ["Phonebanker", "Last end", "Minutes before as-of", "Calls"],
    flagRows(result.shiftFlags, "lunch")
  );
  addSheet(
    workbook,
    used,
    "Stopped early",
    ["Phonebanker", "Last end", "Minutes early", "Calls"],
    flagRows(result.shiftFlags, "early")
  );

  addSheet(
    workbook,
    used,
    "Gaps",
    ["Phonebanker", "Gap", "From", "To", "Notes"],
    gapListRows(result.gapDetails)
  );

  const matrix = matrixRows(result.gapDetails);
  addSheet(workbook, used, "Gap matrix", matrix.headers, matrix.rows);

  addSheet(
    workbook,
    used,
    "Call timeline",
    [
      "Phonebanker",
      "Call #",
      "Dial",
      "Connect",
      "End",
      "Duration seconds",
      "Gap since previous end",
      "Disposition",
      "Campaign",
      "Call ID",
    ],
    timelineRows(result.calls)
  );

  const lunchPast = result.gapDetails.filter((g) => g.highlightLunchLong);
  addSheet(
    workbook,
    used,
    "Lunch past return",
    ["Phonebanker", "Gap", "From", "To", "Notes"],
    gapListRows(lunchPast)
  );
  const breakLong = result.gapDetails.filter((g) => g.highlightBreakLong);
  addSheet(
    workbook,
    used,
    "Long break gaps",
    ["Phonebanker", "Gap", "From", "To", "Notes"],
    gapListRows(breakLong)
  );

  const raw = await workbook.xlsx.writeBuffer();
  const view = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}
