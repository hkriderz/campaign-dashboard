import { DateTime } from "luxon";
import type {
  PhonebankCallEvent,
  PhonebankGapDetail,
  PhonebankGapReportResult,
  PhonebankGapShiftSettings,
  PhonebankShiftFlagRow,
  PhonebankerDayStats,
} from "./types";

const LA = "America/Los_Angeles";

export function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map(csvEscape).join(",");
}

export function tsvCell(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).replace(/[\t\r\n]+/g, " ").trim();
}

export function tsvLine(values: Array<string | number | null | undefined>): string {
  return values.map(tsvCell).join("\t");
}

export function formatDurationMinutes(minutes: number): string {
  const mins = Math.round(minutes);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatLaTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(LA);
  return dt.isValid ? dt.toFormat("h:mm a") : "";
}

export function formatLaDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(LA);
  return dt.isValid ? dt.toFormat("MMM d, h:mm a") : "";
}

export function safeDownloadFileName(title: string, extension: "csv" | "xlsx"): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${cleaned || "phonebank-gap-report"}.${extension}`;
}

export function groupGapsChronologically(
  gaps: PhonebankGapDetail[]
): { phonebankerName: string; gaps: PhonebankGapDetail[] }[] {
  const map = new Map<string, PhonebankGapDetail[]>();
  for (const gap of [...gaps].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const list = map.get(gap.phonebankerName) ?? [];
    list.push(gap);
    map.set(gap.phonebankerName, list);
  }
  return [...map.entries()]
    .map(([phonebankerName, personGaps]) => ({ phonebankerName, gaps: personGaps }))
    .sort((a, b) => a.phonebankerName.localeCompare(b.phonebankerName));
}

export function gapNote(gap: PhonebankGapDetail): string {
  return [
    gap.highlightLunchLong
      ? "lunch past return"
      : gap.overlapsLunch
        ? "lunch window"
        : null,
    gap.highlightBreakLong
      ? "break long"
      : gap.overlapsPreLunchBreak
        ? "pre-lunch break"
        : gap.overlapsPostLunchBreak
          ? "post-lunch break"
          : null,
    gap.gapAtOrAbove60 ? "≥60m" : gap.gapAtOrAbove30 ? "≥30m" : null,
    gap.endDisposition || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function summaryBoxCsv(label: string, value: string, help?: string): string {
  return [csvLine([label, value]), help ? csvLine(["Help", help]) : ""].filter(Boolean).join("\r\n");
}

export function pivotTsv(stats: PhonebankerDayStats[]): string {
  const headers = [
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
  ];
  const lines = [tsvLine(headers)];
  for (const row of stats) {
    lines.push(
      tsvLine([
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
      ])
    );
  }
  return lines.join("\n");
}

export function gapsListTsv(gaps: PhonebankGapDetail[]): string {
  const lines = [tsvLine(["Phonebanker", "Gap", "From", "To", "Notes"])];
  for (const gap of gaps.filter((g) => g.gapMinutes > 0)) {
    lines.push(
      tsvLine([
        gap.phonebankerName,
        formatDurationMinutes(gap.gapMinutes),
        formatLaTime(gap.startAt),
        formatLaTime(gap.endAt),
        gapNote(gap),
      ])
    );
  }
  return lines.join("\n");
}

export function gapMatrixTsv(gaps: PhonebankGapDetail[]): string {
  const rows = groupGapsChronologically(gaps.filter((g) => g.gapAtOrAbove5));
  const columnCount = rows.reduce((max, row) => Math.max(max, row.gaps.length), 0);
  const gapHeaders = Array.from({ length: columnCount }, (_, index) => `Gap ${index + 1}`);
  const lines = [tsvLine(["Phonebanker", "Total ≥5m", ...gapHeaders])];
  for (const row of rows) {
    const cells = row.gaps.map(
      (gap) =>
        `${formatDurationMinutes(gap.gapMinutes)} (${formatLaTime(gap.startAt)}-${formatLaTime(gap.endAt)})`
    );
    while (cells.length < columnCount) cells.push("");
    const total = row.gaps.reduce((sum, g) => sum + (g.gapAtOrAbove5 ? g.gapMinutes : 0), 0);
    lines.push(tsvLine([row.phonebankerName, formatDurationMinutes(total), ...cells]));
  }
  return lines.join("\n");
}

export function shiftFlagsTsv(
  title: string,
  rows: Array<{ name: string; detail: string }>
): string {
  const lines = [tsvLine([title]), tsvLine(["Phonebanker", "Detail"])];
  if (!rows.length) {
    lines.push(tsvLine(["None", ""]));
  } else {
    for (const row of rows) lines.push(tsvLine([row.name, row.detail]));
  }
  return lines.join("\n");
}

export function callTimelineTsv(calls: PhonebankCallEvent[]): string {
  const lines = [
    tsvLine([
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
    ]),
  ];
  const byPerson = new Map<string, PhonebankCallEvent[]>();
  for (const call of calls) {
    const list = byPerson.get(call.phonebankerName) ?? [];
    list.push(call);
    byPerson.set(call.phonebankerName, list);
  }
  for (const [name, personCalls] of [...byPerson.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    personCalls.forEach((call, index) => {
      const prev = index > 0 ? personCalls[index - 1] : null;
      let gapLabel = "First call";
      if (prev) {
        const start = DateTime.fromISO(prev.endedAt);
        const end = DateTime.fromISO(call.dialedAt);
        const mins = end.diff(start, "minutes").minutes;
        if (Number.isFinite(mins)) {
          gapLabel =
            mins < 0
              ? `overlap ${formatDurationMinutes(Math.abs(mins))}`
              : formatDurationMinutes(mins);
        }
      }
      lines.push(
        tsvLine([
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
        ])
      );
    });
  }
  return lines.join("\n");
}

export function reportCsv(
  result: PhonebankGapReportResult,
  title: string,
  shiftSettings: PhonebankGapShiftSettings
): string {
  const rows: string[] = [
    csvLine([title]),
    csvLine(["Work date", result.summary.workDate]),
    csvLine([
      "Shift",
      `${shiftSettings.startTime}-${shiftSettings.endTime}`,
      "Lunch",
      `${shiftSettings.lunchClockOutTime}-${shiftSettings.lunchReturnTime}`,
      "Pre-break",
      shiftSettings.preLunchBreakStart,
      "Post-break",
      shiftSettings.postLunchBreakStart,
    ]),
    csvLine([]),
    csvLine(["Summary"]),
    csvLine(["Phonebankers", result.summary.phonebankerCount]),
    csvLine(["Calls", result.summary.callCount]),
    csvLine(["Gaps ≥15m", result.summary.gapsAtOrAbove15]),
    csvLine(["Idle ≥5m", formatDurationMinutes(result.summary.totalIdleMinutesAtOrAbove5)]),
    csvLine(["Largest gap", formatDurationMinutes(result.summary.largestGapMinutes)]),
    csvLine([]),
    csvLine(["By person"]),
  ];

  const pivotLines = pivotTsv(result.phonebankerStats).split("\n");
  for (const line of pivotLines) {
    rows.push(csvLine(line.split("\t")));
  }
  rows.push(csvLine([]));
  rows.push(csvLine(["Gaps >0m"]));
  const gapLines = gapsListTsv(result.gapDetails).split("\n");
  for (const line of gapLines) {
    rows.push(csvLine(line.split("\t")));
  }
  return rows.join("\r\n");
}

export function shiftFlagCopyRows(
  flags: PhonebankShiftFlagRow[],
  kind: "late" | "lunch" | "early"
): Array<{ name: string; detail: string }> {
  if (kind === "late") {
    return flags
      .filter((r) => r.isLateFirstCall)
      .map((r) => ({
        name: r.phonebankerName,
        detail: `${formatLaTime(r.firstDialAt)} · ${r.minutesLateAfterStart ?? 0}m late`,
      }));
  }
  if (kind === "lunch") {
    return flags
      .filter((r) => r.isStillOnLunch)
      .map((r) => ({
        name: r.phonebankerName,
        detail: `Last end ${formatLaTime(r.lastEndedAt)}`,
      }));
  }
  return flags
    .filter((r) => r.isStoppedEarly)
    .map((r) => ({
      name: r.phonebankerName,
      detail: `${formatLaTime(r.lastEndedAt)} · ${r.minutesEarlyBeforeEnd ?? 0}m early`,
    }));
}
