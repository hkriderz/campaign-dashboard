"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { writeTextToClipboard } from "@/lib/browser-clipboard";
import { buildDisplayNameMap, displayNameFor } from "@/lib/canvassing/display-names";
import {
  buildShiftFlagRows,
  currentLaTimeHm,
  defaultShiftSettings,
  excludedLeadRows,
  filterCanvasserStatsForFlags,
  filterKnockResultForReports,
  parseExcludedCanvassers,
  resolveReportDate,
  sortGaps,
  LATE_FIRST_KNOCK_GRACE_MINUTES,
  STOPPED_EARLY_MINUTES,
  type KnockShiftSettings,
  type ShiftFlagRow,
} from "@/lib/canvassing/knock-report-view";
import type {
  CampaignResultSummary,
  CanvasserGapStats,
  CanvassingFileRole,
  CanvassingGapDetail,
  CanvassingReportResult,
  KnockAnalysisReportMode,
  SavedCanvassingReport,
  SavedCanvassingReportListItem,
} from "@/lib/canvassing/types";

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type UploadFile = File;

const ROLE_LABELS: Record<CanvassingFileRole, string> = {
  knock_details: "Knock details",
  campaign_results: "Campaign results",
  unknown: "Unknown",
};
const SESSION_STATE_KEY = "canvassing.knockAnalysis.v3";

type ResultsTab = "pivot" | "gaps" | "shift";

type PersistedKnockAnalysisState = {
  reportName: string;
  reportDate: string;
  previewResult: CanvassingReportResult | null;
  activeReport: SavedCanvassingReport | null;
  excludedCanvassersRaw: string;
  activeResultsTab: ResultsTab;
  reportMode: KnockAnalysisReportMode;
  startTime: string;
  lunchClockOutTime: string;
  lunchReturnTime: string;
  endTime: string;
  asOfTime: string;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  const totalSeconds = Math.max(0, Math.round(value * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Short duration for notes/chats (e.g. 1h 20m, 45m). */
function formatDurationReadable(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  const totalMinutes = Math.max(0, Math.round(value));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
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

function formatTimeShort(value: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
}

function formatReportDate(value: string | null | undefined): string {
  if (!value) return "No report date";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function fileKey(file: UploadFile): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function fileRelativePath(file: UploadFile): string {
  return file.name;
}

function reportTitleFor(result: CanvassingReportResult, reportDate?: string): string {
  return `Knock analysis for ${formatReportDate(reportDate || result.summary.detectedReportDate)}`;
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map(csvEscape).join(",");
}

function tsvCell(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).replace(/[\t\r\n]+/g, " ").trim();
}

function tsvLine(values: Array<string | number | null | undefined>): string {
  return values.map(tsvCell).join("\t");
}

type CopyTextHandler = (text: string, successMessage: string) => void;

const KNOCK_PIVOT_HEADERS = [
  "Canvasser",
  "Longest Gap",
  "Longest gap start",
  "Longest gap end",
  "First Knock",
  "Most recent knock",
  "Gap length total",
  "Average non zero gap",
];

function knockPivotCsv(stats: CanvasserGapStats[]): string {
  const rows = [csvLine(KNOCK_PIVOT_HEADERS)];

  for (const stat of [...stats].sort(compareCanvasserStats)) {
    rows.push(
      csvLine([
        stat.canvasserName,
        formatDuration(stat.largestGapMinutes),
        formatTime(stat.largestGapStartAt),
        formatTime(stat.largestGapEndAt),
        formatTime(stat.firstKnockAt),
        formatTime(stat.mostRecentKnockAt),
        formatDuration(stat.totalGapMinutesOver10),
        formatDuration(stat.averageNonZeroGapMinutes),
      ])
    );
  }

  return rows.join("\r\n");
}

function knockPivotTsv(stats: CanvasserGapStats[]): string {
  const rows = [tsvLine(KNOCK_PIVOT_HEADERS)];

  for (const stat of [...stats].sort(compareCanvasserStats)) {
    rows.push(
      tsvLine([
        stat.canvasserName,
        formatDuration(stat.largestGapMinutes),
        formatTime(stat.largestGapStartAt),
        formatTime(stat.largestGapEndAt),
        formatTime(stat.firstKnockAt),
        formatTime(stat.mostRecentKnockAt),
        formatDuration(stat.totalGapMinutesOver10),
        formatDuration(stat.averageNonZeroGapMinutes),
      ])
    );
  }

  return rows.join("\n");
}

function gapsListTsv(gaps: CanvassingGapDetail[], includeDetails: boolean): string {
  const rows = [
    includeDetails
      ? tsvLine(["Canvasser", "Gap Length", "Start Time", "End Time", "End Voter", "End Response"])
      : tsvLine(["Canvasser", "Gap Length"]),
  ];

  for (const gap of sortGaps(gaps)) {
    rows.push(
      includeDetails
        ? tsvLine([
            gap.canvasserName,
            formatDuration(gap.gapMinutes),
            formatTime(gap.startAt),
            formatTime(gap.endAt),
            gap.endVoter || "n/a",
            gap.endResponse || "n/a",
          ])
        : tsvLine([gap.canvasserName, formatDuration(gap.gapMinutes)])
    );
  }

  return rows.join("\n");
}

function gapsListText(title: string, gaps: CanvassingGapDetail[], includeDetails: boolean): string {
  const sorted = sortGaps(gaps);
  const lines = [`${title} (${sorted.length})`, ""];
  if (!sorted.length) {
    lines.push("None.");
    return lines.join("\n");
  }
  for (const gap of sorted) {
    if (includeDetails) {
      lines.push(
        `- ${gap.canvasserName} — ${formatDurationReadable(gap.gapMinutes)} (${formatTimeShort(gap.startAt)} to ${formatTimeShort(gap.endAt)}; end voter ${gap.endVoter || "n/a"} / ${gap.endResponse || "n/a"})`
      );
    } else {
      lines.push(`- ${gap.canvasserName} — ${formatDurationReadable(gap.gapMinutes)}`);
    }
  }
  return lines.join("\n");
}

function shiftFlagsTsv(rows: ShiftFlagRow[], kind: "late" | "lunch" | "early"): string {
  if (kind === "late") {
    return [
      tsvLine(["Canvasser", "First Knock", "Minutes after start", "Knocks"]),
      ...rows.map((row) =>
        tsvLine([
          row.canvasserName,
          formatTime(row.firstKnockAt),
          row.minutesLateAfterStart ?? "",
          row.knockCount,
        ])
      ),
    ].join("\n");
  }
  if (kind === "lunch") {
    return [
      tsvLine(["Canvasser", "Last Knock", "Minutes before as-of", "Knocks"]),
      ...rows.map((row) =>
        tsvLine([
          row.canvasserName,
          formatTime(row.mostRecentKnockAt),
          row.minutesBeforeAsOf ?? "",
          row.knockCount,
        ])
      ),
    ].join("\n");
  }
  return [
    tsvLine(["Canvasser", "Last Knock", "Minutes before end", "Knocks"]),
    ...rows.map((row) =>
      tsvLine([
        row.canvasserName,
        formatTime(row.mostRecentKnockAt),
        row.minutesEarlyBeforeEnd ?? "",
        row.knockCount,
      ])
    ),
  ].join("\n");
}

function shiftFlagsListText(
  title: string,
  rows: ShiftFlagRow[],
  kind: "late" | "lunch" | "early",
  includeDetails: boolean
): string {
  const lines = [`${title} (${rows.length})`, ""];
  if (!rows.length) {
    lines.push("None.");
    return lines.join("\n");
  }
  for (const row of rows) {
    if (kind === "late") {
      const base = `- ${row.canvasserName} — first knock ${formatTimeShort(row.firstKnockAt)}`;
      lines.push(
        includeDetails
          ? `${base} (${formatDurationReadable(row.minutesLateAfterStart)} after start) · ${formatNumber(row.knockCount)} knocks`
          : base
      );
    } else if (kind === "lunch") {
      const base = `- ${row.canvasserName} — last knock ${formatTimeShort(row.mostRecentKnockAt)}`;
      lines.push(
        includeDetails
          ? `${base} (${formatDurationReadable(row.minutesBeforeAsOf)} before as-of) · ${formatNumber(row.knockCount)} knocks`
          : base
      );
    } else {
      const base = `- ${row.canvasserName} — last knock ${formatTimeShort(row.mostRecentKnockAt)}`;
      lines.push(
        includeDetails
          ? `${base} (${formatDurationReadable(row.minutesEarlyBeforeEnd)} before end) · ${formatNumber(row.knockCount)} knocks`
          : base
      );
    }
  }
  return lines.join("\n");
}

function excludedLeadsListText(leads: CanvasserGapStats[]): string {
  const lines = [`Excluded from gap report (leads) (${leads.length})`, ""];
  if (!leads.length) {
    lines.push("None.");
    return lines.join("\n");
  }
  for (const lead of leads) {
    lines.push(`- ${lead.canvasserName} — ${formatNumber(lead.knockCount)} knocks`);
  }
  return lines.join("\n");
}

function summaryBoxCsv(label: string, value: string, help?: string): string {
  return [csvLine(["Metric", "Value", "Details"]), csvLine([label, value, help || ""])].join("\r\n");
}

function campaignResultCsv(campaign: CampaignResultSummary): string {
  const rows = [
    csvLine([campaign.campaignName]),
    csvLine(["File", campaign.fileName]),
    csvLine(["Sheet", campaign.sheetName || "n/a"]),
    csvLine(["Canvassers", campaign.canvasserCount]),
    csvLine(["Rows", campaign.rowCount]),
    csvLine([]),
    csvLine(["Canvasser", ...campaign.resultColumns]),
  ];

  for (const canvasser of campaign.canvassers) {
    rows.push(csvLine([canvasser.canvasserName, ...campaign.resultColumns.map((column) => canvasser.totals[column] ?? 0)]));
  }

  rows.push(csvLine(["Total", ...campaign.resultColumns.map((column) => campaign.totals[column] ?? 0)]));
  return rows.join("\r\n");
}

function campaignResultTsv(campaign: CampaignResultSummary): string {
  const rows = [
    tsvLine([campaign.campaignName]),
    tsvLine(["File", campaign.fileName]),
    tsvLine(["Sheet", campaign.sheetName || "n/a"]),
    tsvLine(["Canvassers", campaign.canvasserCount]),
    tsvLine(["Rows", campaign.rowCount]),
    tsvLine([]),
    tsvLine(["Canvasser", ...campaign.resultColumns]),
  ];

  for (const canvasser of campaign.canvassers) {
    rows.push(tsvLine([canvasser.canvasserName, ...campaign.resultColumns.map((column) => canvasser.totals[column] ?? 0)]));
  }

  rows.push(tsvLine(["Total", ...campaign.resultColumns.map((column) => campaign.totals[column] ?? 0)]));
  return rows.join("\n");
}

function reportCsv(result: CanvassingReportResult, title: string, reportDate?: string): string {
  const rows: string[] = [
    csvLine([title]),
    csvLine(["Report Date", formatReportDate(reportDate || result.summary.detectedReportDate)]),
    csvLine([]),
    knockPivotCsv(result.canvasserStats),
  ];

  return rows.join("\r\n");
}

function safeCsvFileName(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${cleaned || "knock-analysis-report"}.csv`;
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

function resultIssueTone(severity: string): string {
  if (severity === "error") return "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200";
  return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200";
}

function readPersistedState(): PersistedKnockAnalysisState {
  const lunchDefaults = defaultShiftSettings("lunch");
  const fallback: PersistedKnockAnalysisState = {
    reportName: "",
    reportDate: "",
    previewResult: null,
    activeReport: null,
    excludedCanvassersRaw: "",
    activeResultsTab: "pivot",
    reportMode: "lunch",
    startTime: lunchDefaults.startTime,
    lunchClockOutTime: lunchDefaults.lunchClockOutTime,
    lunchReturnTime: lunchDefaults.lunchReturnTime,
    endTime: lunchDefaults.endTime,
    asOfTime: lunchDefaults.asOfTime,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedKnockAnalysisState>;
    const mode: KnockAnalysisReportMode = parsed.reportMode === "final" ? "final" : "lunch";
    const modeDefaults = defaultShiftSettings(mode);
    const tab =
      parsed.activeResultsTab === "gaps" || parsed.activeResultsTab === "shift"
        ? parsed.activeResultsTab
        : "pivot";
    return {
      reportName: typeof parsed.reportName === "string" ? parsed.reportName : "",
      reportDate: typeof parsed.reportDate === "string" ? parsed.reportDate : "",
      previewResult: parsed.previewResult ?? null,
      activeReport: parsed.activeReport ?? null,
      excludedCanvassersRaw:
        typeof parsed.excludedCanvassersRaw === "string" ? parsed.excludedCanvassersRaw : "",
      activeResultsTab: tab,
      reportMode: mode,
      startTime: typeof parsed.startTime === "string" ? parsed.startTime : modeDefaults.startTime,
      lunchClockOutTime:
        typeof parsed.lunchClockOutTime === "string"
          ? parsed.lunchClockOutTime
          : modeDefaults.lunchClockOutTime,
      lunchReturnTime:
        typeof parsed.lunchReturnTime === "string"
          ? parsed.lunchReturnTime
          : modeDefaults.lunchReturnTime,
      endTime: typeof parsed.endTime === "string" ? parsed.endTime : modeDefaults.endTime,
      asOfTime: typeof parsed.asOfTime === "string" ? parsed.asOfTime : currentLaTimeHm(),
    };
  } catch {
    return fallback;
  }
}

function CopyMiniButton({ label = "Copy", onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 transition-all hover:bg-gray-50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-white/5"
    >
      {label}
    </button>
  );
}

function StatTile({
  label,
  value,
  help,
  onCopy,
}: {
  label: string;
  value: string;
  help?: string;
  onCopy?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
        {onCopy ? <CopyMiniButton onClick={onCopy} /> : null}
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-50">{value}</p>
      {help ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{help}</p> : null}
    </div>
  );
}

function SourceFileList({ result }: { result: CanvassingReportResult }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Detected files</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-white/10">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="py-2 pr-4">File</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Rows</th>
              <th className="py-2 pr-4">Sheet</th>
              <th className="py-2 pr-4">Columns</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/10">
            {result.sourceFiles.map((file) => (
              <tr key={file.id} className="text-gray-700 dark:text-gray-300">
                <td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">{file.relativePath}</td>
                <td className="py-3 pr-4">
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 dark:bg-white/10 dark:text-gray-200">
                    {ROLE_LABELS[file.role]}
                  </span>
                </td>
                <td className="py-3 pr-4">{formatNumber(file.rowCount)}</td>
                <td className="py-3 pr-4">{file.sheetName || "n/a"}</td>
                <td className="py-3 pr-4 text-xs text-gray-500 dark:text-gray-400">
                  {file.columns.slice(0, 6).join(", ")}
                  {file.columns.length > 6 ? " ..." : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ValidationIssues({ result }: { result: CanvassingReportResult }) {
  if (!result.validationIssues.length) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        No validation issues were found in this preview.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Validation issues</h2>
      <div className="mt-4 space-y-2">
        {result.validationIssues.slice(0, 15).map((issue, index) => (
          <div key={`${issue.code}-${index}`} className={`rounded-xl border p-3 text-sm ${resultIssueTone(issue.severity)}`}>
            <p className="font-semibold">{issue.message}</p>
            <p className="mt-1 text-xs opacity-80">
              {[issue.fileName, issue.sheetName, issue.rowNumber ? `row ${issue.rowNumber}` : ""].filter(Boolean).join(" / ")}
            </p>
          </div>
        ))}
        {result.validationIssues.length > 15 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Showing 15 of {result.validationIssues.length} issues.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CanvasserStatsTable({
  stats,
  onCopyText,
}: {
  stats: CanvasserGapStats[];
  onCopyText: CopyTextHandler;
}) {
  if (!stats.length) return null;
  const sortedStats = [...stats].sort(compareCanvasserStats);
  const displayNames = buildDisplayNameMap(sortedStats.map((row) => row.canvasserName));
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Knock analysis pivot</h2>
        <CopyMiniButton
          label="Copy Table"
          onClick={() => onCopyText(knockPivotTsv(stats), "Knock analysis pivot copied for Sheets.")}
        />
      </div>
      <div className="mt-4 max-h-[70vh] overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-white shadow-sm dark:bg-gray-900">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="sticky left-0 z-30 bg-white py-2 pr-4 dark:bg-gray-900">Canvasser</th>
              <th className="bg-white py-2 pr-4 dark:bg-gray-900">Longest Gap</th>
              <th className="bg-white py-2 pr-4 dark:bg-gray-900">Longest gap start</th>
              <th className="bg-white py-2 pr-4 dark:bg-gray-900">Longest gap end</th>
              <th className="bg-white py-2 pr-4 dark:bg-gray-900">First Knock</th>
              <th className="bg-white py-2 pr-4 dark:bg-gray-900">Most recent</th>
              <th className="bg-white py-2 pr-4 dark:bg-gray-900">Gap length total</th>
              <th className="bg-white py-2 pr-4 dark:bg-gray-900">Average non zero gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/10">
            {sortedStats.map((row) => (
              <tr key={row.canvasserName} className="text-gray-700 dark:text-gray-300">
                <td
                  className="sticky left-0 z-10 bg-inherit py-3 pr-4 font-medium text-gray-900 dark:text-gray-100"
                  title={row.canvasserName}
                >
                  {displayNameFor(row.canvasserName, displayNames)}
                </td>
                <td className="py-3 pr-4 tabular-nums">{formatDuration(row.largestGapMinutes)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatTime(row.largestGapStartAt)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatTime(row.largestGapEndAt)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatTime(row.firstKnockAt)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatTime(row.mostRecentKnockAt)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatDuration(row.totalGapMinutesOver10)}</td>
                <td className="py-3 pr-4 tabular-nums">{formatDuration(row.averageNonZeroGapMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CampaignResultCard({
  campaign,
  onCopyText,
}: {
  campaign: CampaignResultSummary;
  onCopyText: CopyTextHandler;
}) {
  const columns = campaign.resultColumns.slice(0, 8);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{campaign.campaignName}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {campaign.canvasserCount} canvassers / {campaign.rowCount} rows
          </p>
        </div>
        <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-200">
          {campaign.fileName}
        </span>
      </div>
      <div className="mt-3">
        <CopyMiniButton
          label="Copy Table"
          onClick={() => onCopyText(campaignResultTsv(campaign), `${campaign.campaignName} copied for Sheets.`)}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {columns.map((column) => (
          <div key={column} className="rounded-xl bg-gray-50 p-3 dark:bg-white/5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{column}</p>
            <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-50">{formatNumber(campaign.totals[column] ?? 0)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function GapCards({
  title,
  emptyLabel,
  gaps,
  onCopyText,
}: {
  title: string;
  emptyLabel: string;
  gaps: CanvassingGapDetail[];
  onCopyText: CopyTextHandler;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const sorted = sortGaps(gaps);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{title}</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{sorted.length} gaps</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.98] dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5">
            <input
              type="checkbox"
              checked={showDetails}
              onChange={(event) => setShowDetails(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
            Show full details
          </label>
          <CopyMiniButton
            label="Copy as list"
            onClick={() => onCopyText(gapsListText(title, sorted, showDetails), `${title} list copied.`)}
          />
          <CopyMiniButton
            label="Copy Table"
            onClick={() => onCopyText(gapsListTsv(sorted, showDetails), `${title} copied for Sheets.`)}
          />
        </div>
      </div>
      {sorted.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {sorted.slice(0, 50).map((gap, index) => (
            <div key={`${gap.canvasserName}-${gap.startAt}-${index}`} className="rounded-xl bg-gray-50 p-4 dark:bg-white/5">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-gray-900 dark:text-gray-50">{gap.canvasserName}</p>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-violet-700 dark:text-violet-200">
                  {formatDuration(gap.gapMinutes)}
                </p>
              </div>
              {showDetails ? (
                <>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {formatTime(gap.startAt)} to {formatTime(gap.endAt)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    End voter: {gap.endVoter || "n/a"} / Response: {gap.endResponse || "n/a"}
                  </p>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">{emptyLabel}</p>
      )}
    </div>
  );
}

function ShiftFlagCards({
  title,
  help,
  rows,
  kind,
  onCopyText,
}: {
  title: string;
  help: string;
  rows: ShiftFlagRow[];
  kind: "late" | "lunch" | "early";
  onCopyText: CopyTextHandler;
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{title}</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{help}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.98] dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5">
            <input
              type="checkbox"
              checked={showDetails}
              onChange={(event) => setShowDetails(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
            Show full details
          </label>
          <CopyMiniButton
            label="Copy as list"
            onClick={() =>
              onCopyText(shiftFlagsListText(title, rows, kind, showDetails), `${title} list copied.`)
            }
          />
          <CopyMiniButton
            label="Copy Table"
            onClick={() => onCopyText(shiftFlagsTsv(rows, kind), `${title} copied for Sheets.`)}
          />
        </div>
      </div>
      {rows.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {rows.slice(0, 50).map((row) => (
            <div key={`${kind}-${row.canvasserName}`} className="rounded-xl bg-gray-50 p-4 dark:bg-white/5">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-gray-900 dark:text-gray-50">{row.canvasserName}</p>
                {showDetails ? (
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-violet-700 dark:text-violet-200">
                    {kind === "late"
                      ? formatDuration(row.minutesLateAfterStart ?? 0)
                      : kind === "lunch"
                        ? formatDuration(row.minutesBeforeAsOf ?? 0)
                        : formatDuration(row.minutesEarlyBeforeEnd ?? 0)}
                  </p>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {kind === "late"
                  ? `First knock ${formatTime(row.firstKnockAt)}`
                  : `Last knock ${formatTime(row.mostRecentKnockAt)}`}
                {showDetails ? ` · ${formatNumber(row.knockCount)} knocks` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No canvassers matched this section.</p>
      )}
    </div>
  );
}

function ReportResults({
  result,
  title,
  reportDate,
  activeTab,
  onTabChange,
  reportMode,
  shiftSettings,
  excludedLeads,
  excludedCanvassers,
  onCopyText,
}: {
  result: CanvassingReportResult;
  title: string;
  reportDate?: string;
  activeTab: ResultsTab;
  onTabChange: (tab: ResultsTab) => void;
  reportMode: KnockAnalysisReportMode;
  shiftSettings: KnockShiftSettings;
  excludedLeads: CanvasserGapStats[];
  excludedCanvassers: Set<string>;
  onCopyText: CopyTextHandler;
}) {
  const displayDate = reportDate || result.summary.detectedReportDate;
  const isoDate = resolveReportDate(result, reportDate);
  const flagStats = filterCanvasserStatsForFlags(result.canvasserStats, excludedCanvassers);
  const shiftRows = buildShiftFlagRows(flagStats, shiftSettings, isoDate);
  const lateFirst = shiftRows.filter((row) => row.isLateFirstKnock).sort(
    (a, b) => (b.minutesLateAfterStart ?? 0) - (a.minutesLateAfterStart ?? 0)
  );
  const stillOnLunch = shiftRows.filter((row) => row.isStillOnLunch).sort(
    (a, b) => (b.minutesBeforeAsOf ?? 0) - (a.minutesBeforeAsOf ?? 0)
  );
  const stoppedEarly = shiftRows.filter((row) => row.isStoppedEarly).sort(
    (a, b) => (b.minutesEarlyBeforeEnd ?? 0) - (a.minutesEarlyBeforeEnd ?? 0)
  );
  const hourGaps = result.hourGapDetails ?? result.gapDetails.filter((gap) => gap.gapMinutes >= 60);
  const outlierGaps = result.outlierGapDetails ?? result.gapDetails.filter((gap) => gap.gapMinutes >= 120);
  const modeLabel = reportMode === "lunch" ? "First / Lunch Gap Report" : "Last Knocks / Final Gap Report";
  const summaryTiles = [
    {
      label: "Valid knock events",
      value: formatNumber(result.summary.validKnockEvents),
      help: `${formatNumber(result.summary.invalidKnockRows)} invalid rows`,
    },
    {
      label: "Canvassers in report",
      value: formatNumber(result.summary.totalCanvassers),
      help: excludedLeads.length ? `${excludedLeads.length} leads excluded from gap report` : "From knock details",
    },
    {
      label: "Gaps over 1 hour",
      value: formatNumber(result.summary.gapsOver60 ?? hourGaps.length),
      help: `${formatNumber(result.summary.outlierGapsOver120 ?? outlierGaps.length)} outliers (2h+)`,
    },
    {
      label: "Total gap time (>10m)",
      value: formatDuration(result.summary.totalGapMinutesOver10),
      help: `Largest ${formatDuration(result.summary.largestGapMinutes)}`,
    },
  ];

  const tabClass = (tab: ResultsTab) =>
    `rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 ${
      activeTab === tab
        ? "bg-violet-600 text-white shadow-sm"
        : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
    }`;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-500 dark:text-violet-300">{title}</p>
        <h2 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-50">
          {modeLabel} · {formatReportDate(displayDate)}
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Shift {shiftSettings.startTime}–{shiftSettings.endTime} LA
          {reportMode === "lunch"
            ? ` · lunch ${shiftSettings.lunchClockOutTime}–${shiftSettings.lunchReturnTime} · as-of ${shiftSettings.asOfTime}`
            : ""}
          .
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryTiles.map((tile) => (
          <StatTile
            key={tile.label}
            label={tile.label}
            value={tile.value}
            help={tile.help}
            onCopy={() => onCopyText(summaryBoxCsv(tile.label, tile.value, tile.help), `${tile.label} copied.`)}
          />
        ))}
      </div>

      {excludedLeads.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Excluded from gap report (leads)
              </h3>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Still in the saved data, campaign workbooks, and the knock analysis pivot; omitted from gap/shift
                flags only.
              </p>
            </div>
            <CopyMiniButton
              label="Copy as list"
              onClick={() =>
                onCopyText(excludedLeadsListText(excludedLeads), "Excluded leads list copied.")
              }
            />
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {excludedLeads.map((lead) => (
              <li
                key={lead.canvasserName}
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-900 shadow-sm dark:bg-amber-950/40 dark:text-amber-100"
              >
                {lead.canvasserName} · {formatNumber(lead.knockCount)} knocks
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ValidationIssues result={result} />
      <SourceFileList result={result} />

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onTabChange("shift")} className={tabClass("shift")}>
          {reportMode === "lunch" ? "Lunch flags" : "Final flags"}
        </button>
        <button type="button" onClick={() => onTabChange("gaps")} className={tabClass("gaps")}>
          Gaps 1h / 2h+
        </button>
        <button type="button" onClick={() => onTabChange("pivot")} className={tabClass("pivot")}>
          Pivot
        </button>
      </div>

      {activeTab === "shift" && reportMode === "lunch" ? (
        <div className="space-y-4">
          <ShiftFlagCards
            title="Late first knocks"
            help={`First knock at least ${LATE_FIRST_KNOCK_GRACE_MINUTES} minutes after the configured start time (e.g. 12:30 start flags from 1:00).`}
            rows={lateFirst}
            kind="late"
            onCopyText={onCopyText}
          />
          <ShiftFlagCards
            title="Still on lunch"
            help={`No knock at or after lunch return (${shiftSettings.lunchReturnTime}) while as-of is ${shiftSettings.asOfTime} or later. Lunch window ${shiftSettings.lunchClockOutTime}–${shiftSettings.lunchReturnTime}.`}
            rows={stillOnLunch}
            kind="lunch"
            onCopyText={onCopyText}
          />
        </div>
      ) : null}

      {activeTab === "shift" && reportMode === "final" ? (
        <ShiftFlagCards
          title="Stopped knocking early"
          help={`Last knock at least ${STOPPED_EARLY_MINUTES} minutes before the configured end time.`}
          rows={stoppedEarly}
          kind="early"
          onCopyText={onCopyText}
        />
      ) : null}

      {activeTab === "gaps" ? (
        <div className="space-y-4">
          <GapCards
            title="Gaps over 1 hour"
            emptyLabel="No gaps of 1 hour or more for this report."
            gaps={hourGaps}
            onCopyText={onCopyText}
          />
          <GapCards
            title="Outliers (2 hours and over)"
            emptyLabel="No outlier gaps of 2 hours or more for this report."
            gaps={outlierGaps}
            onCopyText={onCopyText}
          />
        </div>
      ) : null}

      {activeTab === "pivot" ? <CanvasserStatsTable stats={result.canvasserStats} onCopyText={onCopyText} /> : null}

      {result.campaignResults.length ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Campaign result workbooks</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Productivity totals keep all canvassers, including excluded leads.
          </p>
          {result.campaignResults.map((campaign) => (
            <CampaignResultCard
              key={`${campaign.fileName}-${campaign.sheetName ?? ""}`}
              campaign={campaign}
              onCopyText={onCopyText}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function CanvassingClient() {
  const initialState = useMemo(() => readPersistedState(), []);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [reportName, setReportName] = useState(initialState.reportName);
  const [reportDate, setReportDate] = useState(initialState.reportDate);
  const [previewResult, setPreviewResult] = useState<CanvassingReportResult | null>(initialState.previewResult);
  const [savedReports, setSavedReports] = useState<SavedCanvassingReportListItem[]>([]);
  const [activeReport, setActiveReport] = useState<SavedCanvassingReport | null>(initialState.activeReport);
  const [excludedCanvassersRaw, setExcludedCanvassersRaw] = useState(initialState.excludedCanvassersRaw);
  const [activeResultsTab, setActiveResultsTab] = useState<ResultsTab>(initialState.activeResultsTab);
  const [reportMode, setReportMode] = useState<KnockAnalysisReportMode>(initialState.reportMode);
  const [startTime, setStartTime] = useState(initialState.startTime);
  const [lunchClockOutTime, setLunchClockOutTime] = useState(initialState.lunchClockOutTime);
  const [lunchReturnTime, setLunchReturnTime] = useState(initialState.lunchReturnTime);
  const [endTime, setEndTime] = useState(initialState.endTime);
  const [asOfTime, setAsOfTime] = useState(initialState.asOfTime);
  const [loadingReports, setLoadingReports] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedFileCount = files.length;
  const selectedBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const rawCurrentResult = activeReport ?? previewResult;
  const excludedCanvassers = useMemo(() => parseExcludedCanvassers(excludedCanvassersRaw), [excludedCanvassersRaw]);
  const currentResult = useMemo(
    () => filterKnockResultForReports(rawCurrentResult, excludedCanvassers),
    [excludedCanvassers, rawCurrentResult]
  );
  const excludedLeads = useMemo(
    () => excludedLeadRows(rawCurrentResult, excludedCanvassers),
    [excludedCanvassers, rawCurrentResult]
  );
  const shiftSettings = useMemo<KnockShiftSettings>(
    () => ({
      mode: reportMode,
      startTime,
      lunchClockOutTime,
      lunchReturnTime,
      endTime,
      asOfTime,
    }),
    [asOfTime, endTime, lunchClockOutTime, lunchReturnTime, reportMode, startTime]
  );
  const currentReportDate = activeReport?.reportDate || reportDate || currentResult?.summary.detectedReportDate || "";
  const currentReportTitle = currentResult
    ? activeReport?.name || reportTitleFor(currentResult, currentReportDate)
    : "";

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch("/api/canvassing/reports", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<{ reports: SavedCanvassingReportListItem[] }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to load saved reports.");
      setSavedReports(json.data.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    const state: PersistedKnockAnalysisState = {
      reportName,
      reportDate,
      previewResult,
      activeReport,
      excludedCanvassersRaw,
      activeResultsTab,
      reportMode,
      startTime,
      lunchClockOutTime,
      lunchReturnTime,
      endTime,
      asOfTime,
    };
    window.sessionStorage.setItem(SESSION_STATE_KEY, JSON.stringify(state));
  }, [
    activeReport,
    activeResultsTab,
    asOfTime,
    endTime,
    excludedCanvassersRaw,
    lunchClockOutTime,
    lunchReturnTime,
    previewResult,
    reportDate,
    reportMode,
    reportName,
    startTime,
  ]);

  function applyReportMode(mode: KnockAnalysisReportMode) {
    const defaults = defaultShiftSettings(mode);
    setReportMode(mode);
    setStartTime(defaults.startTime);
    setLunchClockOutTime(defaults.lunchClockOutTime);
    setLunchReturnTime(defaults.lunchReturnTime);
    setEndTime(defaults.endTime);
    setAsOfTime(currentLaTimeHm());
    setActiveResultsTab("shift");
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList) as UploadFile[];
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      const next = [...current];
      for (const file of incoming) {
        if (!seen.has(fileKey(file))) next.push(file);
      }
      return next;
    });
    setPreviewResult(null);
    setActiveReport(null);
    setReportDate("");
    setMessage("");
    setError("");
  }

  function buildFormData(): FormData {
    const form = new FormData();
    const relativePaths: string[] = [];
    for (const file of files) {
      form.append("files", file, file.name);
      relativePaths.push(fileRelativePath(file));
    }
    form.set("relativePaths", JSON.stringify(relativePaths));
    form.set("name", reportName);
    form.set("reportDate", reportDate);
    return form;
  }

  async function previewUpload() {
    setError("");
    setMessage("");
    if (!files.length) {
      setError("Choose CSV or XLSX files first.");
      return;
    }

    setPreviewing(true);
    try {
      const res = await fetch("/api/canvassing/preview", { method: "POST", body: buildFormData() });
      const json = (await res.json()) as ApiResponse<{ result: CanvassingReportResult }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to preview canvassing files.");
      const result = json.data.result;
      const nextReportDate = result.summary.detectedReportDate || reportDate;
      setPreviewResult(result);
      setActiveReport(null);
      setActiveResultsTab("shift");
      setAsOfTime(currentLaTimeHm());
      if (nextReportDate) {
        setReportDate(nextReportDate);
      }
      setReportName(reportTitleFor(result, nextReportDate));
      setMessage("Report run complete. Review the results, then save the report when ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  }

  function downloadReportCsv() {
    setError("");
    setMessage("");
    if (!currentResult) {
      setError("Run or open a report before downloading CSV.");
      return;
    }

    const csv = reportCsv(currentResult, currentReportTitle, currentReportDate);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeCsvFileName(currentReportTitle);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function copyReportCsv() {
    setError("");
    setMessage("");
    if (!currentResult) {
      setError("Run or open a report before copying CSV.");
      return;
    }

    try {
      await writeTextToClipboard(reportCsv(currentResult, currentReportTitle, currentReportDate));
      setMessage("Report CSV copied to clipboard.");
    } catch {
      setError("Unable to copy CSV. Your browser may be blocking clipboard access.");
    }
  }

  async function copyTextToClipboard(text: string, successMessage: string) {
    setError("");
    setMessage("");
    try {
      await writeTextToClipboard(text);
      setMessage(successMessage);
    } catch {
      setError("Unable to copy to clipboard. Your browser may be blocking clipboard access.");
    }
  }

  async function saveReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!files.length) {
      setError("Choose CSV or XLSX files first.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/canvassing/reports", { method: "POST", body: buildFormData() });
      const json = (await res.json()) as ApiResponse<{ report: SavedCanvassingReport }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to save canvassing report.");
      setActiveReport(json.data.report);
      setPreviewResult(null);
      setActiveResultsTab("shift");
      setMessage("Report saved. It is now available without reuploading the source files.");
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function openReport(reportId: string) {
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/canvassing/reports/${encodeURIComponent(reportId)}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<{ report: SavedCanvassingReport }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to open saved report.");
      setActiveReport(json.data.report);
      setPreviewResult(null);
      setActiveResultsTab("shift");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteReport(reportId: string) {
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/canvassing/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" });
      const json = (await res.json()) as ApiResponse<{ deleted: boolean }>;
      if (!json.ok) throw new Error(json.error || "Unable to delete saved report.");
      if (activeReport?.id === reportId) setActiveReport(null);
      setMessage("Saved report deleted.");
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-500 dark:text-violet-300">
          Canvassing
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
          Knock Analysis
        </h1>
        <p className="mt-3 max-w-3xl text-gray-600 dark:text-gray-400">
          Upload PDI Canvasser Details (knock timeline) plus optional campaign result workbooks.
          Choose a Lunch or Final gap report, set shift times, and exclude leads from schedule
          sections while keeping them in the saved data.
        </p>
        <ul className="mt-3 max-w-3xl list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Lunch report</span> — late
            first knocks, gaps ≥ 1 hour / 2 hour outliers, and still-on-lunch vs lunch return + as-of.
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Final report</span> — stopped
            early vs last-door-knock end time, plus the same 1h / 2h+ gap lists and pivot.
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Exclude leads</span> — omit
            irregular lead schedules from gap/shift flags only; the pivot and campaign workbooks still include them.
          </li>
        </ul>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form onSubmit={saveReport} className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Report name</span>
              <input
                type="text"
                value={reportName}
                onChange={(event) => setReportName(event.target.value)}
                placeholder="LA CD11 canvassing report"
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Report date</span>
              <input
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100"
              />
            </label>
          </div>

          <fieldset className="rounded-2xl border border-gray-200 p-4 dark:border-white/10">
            <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-gray-50">Report type</legend>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Defaults (LA): start 12:30, lunch 3:30–4:00, last door knock 7:30. Edit any time below.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-all ${reportMode === "lunch" ? "border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30" : "border-gray-200 dark:border-white/10"}`}>
                <input
                  type="radio"
                  name="reportMode"
                  checked={reportMode === "lunch"}
                  onChange={() => applyReportMode("lunch")}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-50">First / Lunch Gap Report</span>
                  <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                    Late starts, long midday gaps, and people with no knock after lunch return.
                  </span>
                </span>
              </label>
              <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-all ${reportMode === "final" ? "border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30" : "border-gray-200 dark:border-white/10"}`}>
                <input
                  type="radio"
                  name="reportMode"
                  checked={reportMode === "final"}
                  onChange={() => applyReportMode("final")}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-50">Last Knocks / Final Gap Report</span>
                  <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                    Total long gaps and canvassers who stopped well before the last-door-knock time.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Canvasser start (LA)</span>
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Late first knocks use a {LATE_FIRST_KNOCK_GRACE_MINUTES}-minute grace (default start 12:30 → flag from 1:00).
              </span>
            </label>
            {reportMode === "lunch" ? (
              <>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Lunch clock-out (LA)</span>
                  <input
                    type="time"
                    value={lunchClockOutTime}
                    onChange={(event) => setLunchClockOutTime(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
                  />
                  <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                    Expected leave for lunch (default 3:30).
                  </span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Lunch return (LA)</span>
                  <input
                    type="time"
                    value={lunchReturnTime}
                    onChange={(event) => setLunchReturnTime(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
                  />
                  <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                    Expected back knocking (default 4:00). Still-on-lunch uses this.
                  </span>
                </label>
              </>
            ) : null}
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Last door knock (LA)</span>
              <input
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Stopped-early end time (default 7:30).
              </span>
            </label>
            {reportMode === "lunch" ? (
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Report as-of (LA)</span>
                <input
                  type="time"
                  value={asOfTime}
                  onChange={(event) => setAsOfTime(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
                />
                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                  Must be at/after lunch return to flag “still on lunch” (defaults to now when you run).
                </span>
              </label>
            ) : null}
          </div>

          <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-5 dark:border-violet-800 dark:bg-violet-950/20">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Upload files</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Primary file: PDI Canvasser Details CSV/XLSX (CANVASSERNAME … RESPONSE). Optional: campaign
              result workbooks. Use Doorknocks and Results for folder contact-report CSVs.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-violet-700 active:scale-[0.98] focus-within:ring-2 focus-within:ring-violet-400/60">
                Choose files
                <input
                  type="file"
                  multiple
                  accept=".csv,.xlsx"
                  className="sr-only"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)}
                />
              </label>
              {files.length ? (
                <button
                  type="button"
                  onClick={() => {
                    setFiles([]);
                    setPreviewResult(null);
                    setActiveReport(null);
                    setReportDate("");
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
                >
                  Clear selection
                </button>
              ) : null}
            </div>
            <div className="mt-4 rounded-xl bg-white p-3 text-sm text-gray-700 dark:bg-gray-950 dark:text-gray-300">
              <p className="font-medium">
                {selectedFileCount ? `${selectedFileCount} files selected` : "No files selected"}
                {selectedFileCount ? ` / ${(selectedBytes / 1024 / 1024).toFixed(1)} MB` : ""}
              </p>
              {files.length ? (
                <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-gray-500 dark:text-gray-400">
                  {files.map((file) => (
                    <li key={fileKey(file)}>{fileRelativePath(file)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Exclude leads from gap report
            </span>
            <textarea
              value={excludedCanvassersRaw}
              onChange={(event) => setExcludedCanvassersRaw(event.target.value)}
              rows={3}
              placeholder={"One name per line, e.g.\nJane Smith\nSmith, Jane\nLead Name"}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100"
            />
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
              Accepts First Last or Last, First. Omits irregular lead schedules from gap/shift flags only — not
              the knock analysis pivot. Keeps them in saved source data and campaign workbooks.
              {excludedLeads.length
                ? ` ${excludedLeads.length} matching lead${excludedLeads.length === 1 ? "" : "s"} currently excluded from gap/shift flags.`
                : ""}
            </span>
          </label>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              {message}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void previewUpload()}
              disabled={previewing || saving || !files.length}
              className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm transition-all hover:bg-violet-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 dark:border-violet-900 dark:bg-gray-950 dark:text-violet-200 dark:hover:bg-violet-950/30"
            >
              {previewing ? "Running..." : "Run Report"}
            </button>
            <button
              type="submit"
              disabled={previewing || saving || !files.length}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-violet-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
            >
              {saving ? "Saving..." : "Save report"}
            </button>
            <button
              type="button"
              onClick={downloadReportCsv}
              disabled={!currentResult}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
            >
              Download report CSV
            </button>
            <button
              type="button"
              onClick={() => void copyReportCsv()}
              disabled={!currentResult}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
            >
              Copy CSV
            </button>
          </div>
        </form>

        <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Saved reports</h2>
            <button
              type="button"
              onClick={() => void loadReports()}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50 hover:text-violet-900 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 dark:text-violet-300 dark:hover:bg-white/5 dark:hover:text-violet-100"
            >
              Refresh
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {loadingReports ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading reports...</p> : null}
            {!loadingReports && !savedReports.length ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No reports saved yet.</p>
            ) : null}
            {savedReports.map((report) => (
              <div key={report.id} className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => void openReport(report.id)}
                  className="block w-full rounded-lg p-2 text-left transition-all hover:bg-gray-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 dark:hover:bg-white/5"
                >
                  <p className="font-semibold text-gray-900 dark:text-gray-50">{report.name}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {report.reportDate || "No date"} / {formatNumber(report.summary.validKnockEvents)} events /{" "}
                    {formatNumber(report.summary.gapsOver60 ?? report.summary.bigGapsOver30)} gaps ≥1h
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteReport(report.id)}
                  className="mt-2 rounded-md px-1.5 py-1 text-xs font-semibold text-red-600 transition-all hover:bg-red-50 hover:text-red-800 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 dark:text-red-300 dark:hover:bg-red-950/30 dark:hover:text-red-200"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {currentResult ? (
        <ReportResults
          result={currentResult}
          title={activeReport ? `Saved report / ${activeReport.name}` : "Preview"}
          reportDate={activeReport?.reportDate ?? reportDate}
          activeTab={activeResultsTab}
          onTabChange={setActiveResultsTab}
          reportMode={reportMode}
          shiftSettings={shiftSettings}
          excludedLeads={excludedLeads}
          excludedCanvassers={excludedCanvassers}
          onCopyText={(text, successMessage) => void copyTextToClipboard(text, successMessage)}
        />
      ) : null}
    </div>
  );
}
