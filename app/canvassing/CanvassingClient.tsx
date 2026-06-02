"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  CampaignResultSummary,
  CanvasserGapStats,
  CanvassingFileRole,
  CanvassingReportResult,
  SavedCanvassingReport,
  SavedCanvassingReportListItem,
} from "@/lib/canvassing/types";
import { writeTextToClipboard } from "@/lib/browser-clipboard";

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
const SESSION_STATE_KEY = "canvassing.knockAnalysis.v1";

type PersistedKnockAnalysisState = {
  reportName: string;
  reportDate: string;
  previewResult: CanvassingReportResult | null;
  activeReport: SavedCanvassingReport | null;
  excludedCanvassersRaw: string;
  activeResultsTab: "pivot" | "gaps";
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
  "Start Time",
  "End Time",
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

function largestGapsCsv(result: CanvassingReportResult): string {
  const rows = [
    csvLine(["Canvasser", "Start Time", "End Time", "Gap Length", "End Voter", "End Response"]),
  ];

  for (const gap of result.bigGapDetails) {
    rows.push(
      csvLine([
        gap.canvasserName,
        formatTime(gap.startAt),
        formatTime(gap.endAt),
        formatDuration(gap.gapMinutes),
        gap.endVoter || "n/a",
        gap.endResponse || "n/a",
      ])
    );
  }

  return rows.join("\r\n");
}

function largestGapsTsv(result: CanvassingReportResult, includeDetails: boolean): string {
  const rows = [
    includeDetails
      ? tsvLine(["Canvasser", "Gap Length", "Start Time", "End Time", "End Voter", "End Response"])
      : tsvLine(["Canvasser", "Gap Length"]),
  ];

  for (const gap of result.bigGapDetails) {
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

function normalizeCanvasserName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseExcludedCanvassers(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,\n]/)
      .map(normalizeCanvasserName)
      .filter(Boolean)
  );
}

function filterCampaignResult(campaign: CampaignResultSummary, keepName: (name: string) => boolean): CampaignResultSummary {
  const canvassers = campaign.canvassers.filter((row) => keepName(row.canvasserName));
  const totals = campaign.resultColumns.reduce<Record<string, number>>((nextTotals, column) => {
    nextTotals[column] = canvassers.reduce((sum, row) => sum + (row.totals[column] ?? 0), 0);
    return nextTotals;
  }, {});

  return {
    ...campaign,
    canvasserCount: canvassers.length,
    totals,
    canvassers,
  };
}

function filterKnockResult(
  result: CanvassingReportResult | null,
  excludedCanvassers: Set<string>
): CanvassingReportResult | null {
  if (!result || excludedCanvassers.size === 0) return result;

  const keepName = (name: string) => !excludedCanvassers.has(normalizeCanvasserName(name));
  const canvasserStats = result.canvasserStats.filter((row) => keepName(row.canvasserName));
  const gapDetails = result.gapDetails.filter((row) => keepName(row.canvasserName));
  const bigGapDetails = result.bigGapDetails.filter((row) => keepName(row.canvasserName));
  const campaignResults = result.campaignResults.map((campaign) => filterCampaignResult(campaign, keepName));
  const totalGapMinutesOver10 = canvasserStats.reduce((sum, row) => sum + row.totalGapMinutesOver10, 0);
  const largestGapMinutes = canvasserStats.reduce((max, row) => Math.max(max, row.largestGapMinutes), 0);

  return {
    ...result,
    canvasserStats,
    gapDetails,
    bigGapDetails,
    campaignResults,
    summary: {
      ...result.summary,
      totalCanvassers: canvasserStats.length,
      gapsOver10: gapDetails.length,
      bigGapsOver30: bigGapDetails.length,
      totalGapMinutesOver10: Math.round(totalGapMinutesOver10 * 10) / 10,
      largestGapMinutes: Math.round(largestGapMinutes * 10) / 10,
    },
  };
}

function resultIssueTone(severity: string): string {
  if (severity === "error") return "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200";
  return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200";
}

function readPersistedState(): PersistedKnockAnalysisState {
  if (typeof window === "undefined") {
    return {
      reportName: "",
      reportDate: "",
      previewResult: null,
      activeReport: null,
      excludedCanvassersRaw: "",
      activeResultsTab: "pivot",
    };
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_STATE_KEY);
    if (!raw) {
      return {
        reportName: "",
        reportDate: "",
        previewResult: null,
        activeReport: null,
        excludedCanvassersRaw: "",
        activeResultsTab: "pivot",
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedKnockAnalysisState>;
    return {
      reportName: typeof parsed.reportName === "string" ? parsed.reportName : "",
      reportDate: typeof parsed.reportDate === "string" ? parsed.reportDate : "",
      previewResult: parsed.previewResult ?? null,
      activeReport: parsed.activeReport ?? null,
      excludedCanvassersRaw:
        typeof parsed.excludedCanvassersRaw === "string" ? parsed.excludedCanvassersRaw : "",
      activeResultsTab: parsed.activeResultsTab === "gaps" ? "gaps" : "pivot",
    };
  } catch {
    return {
      reportName: "",
      reportDate: "",
      previewResult: null,
      activeReport: null,
      excludedCanvassersRaw: "",
      activeResultsTab: "pivot",
    };
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
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Knock analysis pivot</h2>
        <CopyMiniButton
          label="Copy Table"
          onClick={() => onCopyText(knockPivotTsv(stats), "Knock analysis pivot copied for Sheets.")}
        />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-white/10">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="py-2 pr-4">Canvasser</th>
              <th className="py-2 pr-4">Longest Gap</th>
              <th className="py-2 pr-4">Start Time</th>
              <th className="py-2 pr-4">End Time</th>
              <th className="py-2 pr-4">First Knock</th>
              <th className="py-2 pr-4">Most recent</th>
              <th className="py-2 pr-4">Gap length total</th>
              <th className="py-2 pr-4">Average non zero gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/10">
            {sortedStats.slice(0, 50).map((row) => (
              <tr key={row.canvasserName} className="text-gray-700 dark:text-gray-300">
                <td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">{row.canvasserName}</td>
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

function ReportResults({
  result,
  title,
  reportDate,
  activeTab,
  onTabChange,
  excludedCount,
  onCopyText,
}: {
  result: CanvassingReportResult;
  title: string;
  reportDate?: string;
  activeTab: "pivot" | "gaps";
  onTabChange: (tab: "pivot" | "gaps") => void;
  excludedCount: number;
  onCopyText: CopyTextHandler;
}) {
  const displayDate = reportDate || result.summary.detectedReportDate;
  const [showLargestGapDetails, setShowLargestGapDetails] = useState(false);
  const summaryTiles = [
    {
      label: "Valid knock events",
      value: formatNumber(result.summary.validKnockEvents),
      help: `${formatNumber(result.summary.invalidKnockRows)} invalid rows`,
    },
    {
      label: "Canvassers",
      value: formatNumber(result.summary.totalCanvassers),
      help: "From knock details",
    },
    {
      label: "Gaps over 10 min",
      value: formatNumber(result.summary.gapsOver10),
      help: `${formatNumber(result.summary.bigGapsOver30)} over 30 min`,
    },
    {
      label: "Total gap time",
      value: formatDuration(result.summary.totalGapMinutesOver10),
      help: `Largest ${formatDuration(result.summary.largestGapMinutes)}`,
    },
  ];
  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-500 dark:text-violet-300">{title}</p>
        <h2 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-50">
          Knock analysis for {formatReportDate(displayDate)}
        </h2>
        {excludedCount > 0 ? (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
            Filtered view: {excludedCount} canvasser exception{excludedCount === 1 ? "" : "s"} excluded.
          </p>
        ) : null}
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
      <ValidationIssues result={result} />
      <SourceFileList result={result} />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onTabChange("pivot")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 ${
            activeTab === "pivot"
              ? "bg-violet-600 text-white shadow-sm"
              : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
          }`}
        >
          Pivot
        </button>
        <button
          type="button"
          onClick={() => onTabChange("gaps")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 ${
            activeTab === "gaps"
              ? "bg-violet-600 text-white shadow-sm"
              : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
          }`}
        >
          Largest Gaps
        </button>
      </div>

      {activeTab === "pivot" ? <CanvasserStatsTable stats={result.canvasserStats} onCopyText={onCopyText} /> : null}
      {activeTab === "gaps" ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Largest gaps</h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.98] dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={showLargestGapDetails}
                  onChange={(event) => setShowLargestGapDetails(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                />
                Show full details
              </label>
              <CopyMiniButton
                label="Copy Table"
                onClick={() => onCopyText(largestGapsTsv(result, showLargestGapDetails), "Largest gaps copied for Sheets.")}
              />
            </div>
          </div>
          {result.bigGapDetails.length ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {result.bigGapDetails.slice(0, 50).map((gap, index) => (
                <div key={`${gap.canvasserName}-${gap.startAt}-${index}`} className="rounded-xl bg-gray-50 p-4 dark:bg-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-gray-900 dark:text-gray-50">{gap.canvasserName}</p>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-violet-700 dark:text-violet-200">
                      {formatDuration(gap.gapMinutes)}
                    </p>
                  </div>
                  {showLargestGapDetails ? (
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
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No big gaps found for this report.</p>
          )}
        </div>
      ) : null}
      {result.campaignResults.length ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Campaign result workbooks</h2>
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
  const [activeResultsTab, setActiveResultsTab] = useState<"pivot" | "gaps">(initialState.activeResultsTab);
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
    () => filterKnockResult(rawCurrentResult, excludedCanvassers),
    [excludedCanvassers, rawCurrentResult]
  );
  const currentReportDate = activeReport?.reportDate || reportDate || currentResult?.summary.detectedReportDate || "";
  const currentReportTitle = currentResult
    ? activeReport?.name || reportTitleFor(currentResult, currentReportDate)
    : "";
  const excludedVisibleCount = rawCurrentResult
    ? rawCurrentResult.canvasserStats.filter((row) => excludedCanvassers.has(normalizeCanvasserName(row.canvasserName))).length
    : 0;

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
    };
    window.sessionStorage.setItem(SESSION_STATE_KEY, JSON.stringify(state));
  }, [activeReport, activeResultsTab, excludedCanvassersRaw, previewResult, reportDate, reportName]);

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
      setActiveResultsTab("pivot");
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
      setActiveResultsTab("pivot");
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
      setActiveResultsTab("pivot");
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
          Canvassing uploads and saved reports
        </h1>
        <p className="mt-3 max-w-3xl text-gray-600 dark:text-gray-400">
          Upload the raw PDI Canvasser Details CSV used for knock analysis, plus any campaign result
          workbooks. The app applies the old sheet's time correction and gap calculations directly,
          then saves a report snapshot so the stats can be reopened without reuploading.
        </p>
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

          <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-5 dark:border-violet-800 dark:bg-violet-950/20">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Upload files</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Include the raw PDI export with columns CANVASSERNAME through RESPONSE and any campaign
              result XLSX workbooks. Folder upload will live in Doorknocks and Results.
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
              Exclude canvasser exceptions
            </span>
            <textarea
              value={excludedCanvassersRaw}
              onChange={(event) => setExcludedCanvassersRaw(event.target.value)}
              rows={3}
              placeholder={"One exact canvasser name per line or comma-separated, e.g.\nLead, Canvasser\nSupervisor Name"}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100"
            />
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
              Exact normalized name match only. This filters the view and exports, not the saved source report.
              {excludedVisibleCount > 0 ? ` ${excludedVisibleCount} matching canvasser${excludedVisibleCount === 1 ? "" : "s"} currently excluded.` : ""}
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
                    {report.reportDate || "No date"} / {formatNumber(report.summary.validKnockEvents)} events / {formatNumber(report.summary.bigGapsOver30)} big gaps
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
          excludedCount={excludedVisibleCount}
          onCopyText={(text, successMessage) => void copyTextToClipboard(text, successMessage)}
        />
      ) : null}
    </div>
  );
}
