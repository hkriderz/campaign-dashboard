"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DOORKNOCK_SUMMARY_SETTINGS,
  type DoorknockCampaignReport,
  type DoorknockResultsReport,
  type DoorknockSummaryFlag,
  type DoorknockSummaryFlagKind,
  type DoorknockSummarySettings,
  type SavedDoorknockResultsListItem,
  type SavedDoorknockResultsReport,
} from "@/lib/canvassing/doorknocks-results/types";

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type FolderFile = File & { webkitRelativePath?: string };

type PersistedDoorknockResultsState = {
  reportName: string;
  result: DoorknockResultsReport | null;
  activeReport: SavedDoorknockResultsReport | null;
  settings: DoorknockSummarySettings;
  excludedCanvassersRaw: string;
};

const SUMMARY_LABELS: Record<DoorknockSummaryFlagKind, string> = {
  low_doors_low_support: "People who knocked on less than the target doors with low SS",
  low_contact_rate: "People with low contact rate",
  survey_support_struggle: "People who struggled on survey support",
  non_contact_outlier: "People with non-contact information that stood out",
};

const SESSION_KEY = "canvassing.doorknocksResults.v1";

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "No date detected";
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

function fileKey(file: FolderFile): string {
  return `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`;
}

function filePath(file: FolderFile): string {
  return file.webkitRelativePath || file.name;
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

function safeCsvFileName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${cleaned || "doorknocks-results"}.csv`;
}

function campaignHeaders(campaign: DoorknockCampaignReport): string[] {
  return [
    "Canvasser name",
    "Doors Knocked",
    "Contacts",
    "Contact rate",
    ...campaign.surveyGroups.flatMap((group) => group.columns.map((col) => `${group.question} | ${col.answer}`)),
    ...campaign.nonContactColumns.map((col) => `Non Contact | ${col.label}`),
  ];
}

function campaignCsv(campaign: DoorknockCampaignReport): string {
  const rows = [
    csvLine([campaign.campaignName]),
    csvLine(["Source File", campaign.sourceFile.relativePath]),
    csvLine(["Report Date", formatDate(campaign.reportDate)]),
    csvLine(["Detection Confidence", `${Math.round(campaign.detection.confidence * 100)}%`]),
    csvLine([]),
    csvLine(campaignHeaders(campaign)),
  ];

  for (const row of campaign.rows) {
    rows.push(
      csvLine([
        row.canvasserName,
        row.doorsKnocked,
        row.contacts,
        formatPercent(row.contactRate),
        ...campaign.surveyGroups.flatMap((group) => group.columns.map((col) => row.surveyAnswers[col.key] ?? 0)),
        ...campaign.nonContactColumns.map((col) => row.nonContacts[col.key] ?? 0),
      ])
    );
  }

  rows.push(
    csvLine([
      "Total",
      campaign.totals.doorsKnocked,
      campaign.totals.contacts,
      formatPercent(campaign.totals.contactRate),
      ...campaign.surveyGroups.flatMap((group) => group.columns.map((col) => campaign.totals.surveyAnswers[col.key] ?? 0)),
      ...campaign.nonContactColumns.map((col) => campaign.totals.nonContacts[col.key] ?? 0),
    ])
  );

  return rows.join("\r\n");
}

function campaignTsv(campaign: DoorknockCampaignReport): string {
  const rows = [
    tsvLine([campaign.campaignName]),
    tsvLine(["Source File", campaign.sourceFile.relativePath]),
    tsvLine(["Report Date", formatDate(campaign.reportDate)]),
    tsvLine(["Detection Confidence", `${Math.round(campaign.detection.confidence * 100)}%`]),
    tsvLine([]),
    tsvLine(campaignHeaders(campaign)),
  ];

  for (const row of campaign.rows) {
    rows.push(
      tsvLine([
        row.canvasserName,
        row.doorsKnocked,
        row.contacts,
        formatPercent(row.contactRate),
        ...campaign.surveyGroups.flatMap((group) => group.columns.map((col) => row.surveyAnswers[col.key] ?? 0)),
        ...campaign.nonContactColumns.map((col) => row.nonContacts[col.key] ?? 0),
      ])
    );
  }

  rows.push(
    tsvLine([
      "Total",
      campaign.totals.doorsKnocked,
      campaign.totals.contacts,
      formatPercent(campaign.totals.contactRate),
      ...campaign.surveyGroups.flatMap((group) => group.columns.map((col) => campaign.totals.surveyAnswers[col.key] ?? 0)),
      ...campaign.nonContactColumns.map((col) => campaign.totals.nonContacts[col.key] ?? 0),
    ])
  );

  return rows.join("\n");
}

function summaryBoxCsv(label: string, value: string, help?: string): string {
  return [csvLine(["Metric", "Value", "Details"]), csvLine([label, value, help || ""])].join("\r\n");
}

function formatMetricNumber(value: number | string | undefined): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value === undefined ? "" : String(value);
}

function summaryFlagRegularText(flag: DoorknockSummaryFlag): string {
  switch (flag.kind) {
    case "low_doors_low_support":
      return `${flag.canvasserName} - ${formatMetricNumber(flag.metrics.doorsKnocked)} knocks, ${formatMetricNumber(flag.metrics.contacts)} contacts (${formatMetricNumber(flag.metrics.strongSupport)} SS)`;
    case "low_contact_rate":
      return `${flag.canvasserName} - ${formatMetricNumber(flag.metrics.doorsKnocked)} knocks, ${formatMetricNumber(flag.metrics.contacts)} contacts (${formatMetricNumber(flag.metrics.contactRatePct)}%)`;
    case "survey_support_struggle":
      return `${flag.canvasserName} - ${formatMetricNumber(flag.metrics.strongSupport)} SS, ${formatMetricNumber(flag.metrics.undecided)} U`;
    case "non_contact_outlier":
      return `${flag.canvasserName} - ${formatMetricNumber(flag.metrics.value)} ${formatMetricNumber(flag.metrics.column)}`;
    default:
      return flag.message;
  }
}

function summaryFlagDetailText(flag: DoorknockSummaryFlag): string {
  if (typeof flag.metrics.contactRatePct === "number") {
    return "";
  }
  if (typeof flag.metrics.supportRatePct === "number") {
    const question = typeof flag.metrics.question === "string" ? ` on "${flag.metrics.question}"` : "";
    return `${flag.metrics.supportRatePct.toFixed(1)}% support${question}`;
  }
  return "";
}

function summaryFlagsDisplayText(title: string, flags: DoorknockSummaryFlag[], includeDetails = false): string {
  const lines = [`${title} (${flags.length})`, ""];

  if (!flags.length) {
    lines.push("No flags for this section.");
    return lines.join("\n");
  }

  lines.push(
    ...flags.slice(0, 25).map((flag) => {
      const details = summaryFlagDetailText(flag);
      return includeDetails && details ? `${summaryFlagRegularText(flag)} (${details})` : summaryFlagRegularText(flag);
    })
  );
  if (flags.length > 25) {
    lines.push(`Showing 25 of ${flags.length} flags.`);
  }

  return lines.join("\n");
}

function summaryFlagsCsvLines(title: string, flags: DoorknockSummaryFlag[], includeDetails: boolean): string[] {
  const lines = [csvLine([`${title} (${flags.length})`])];

  if (!flags.length) {
    lines.push(csvLine(["No flags for this section."]));
    return lines;
  }

  lines.push(csvLine(includeDetails ? ["Message", "Percentage"] : ["Message"]));
  for (const flag of flags) {
    lines.push(csvLine(includeDetails ? [summaryFlagRegularText(flag), summaryFlagDetailText(flag)] : [summaryFlagRegularText(flag)]));
  }

  return lines;
}

function summaryFlagsTsvLines(title: string, flags: DoorknockSummaryFlag[], includeDetails: boolean): string[] {
  const lines = [tsvLine([`${title} (${flags.length})`])];

  if (!flags.length) {
    lines.push(tsvLine(["No flags for this section."]));
    return lines;
  }

  lines.push(tsvLine(includeDetails ? ["Message", "Percentage"] : ["Message"]));
  for (const flag of flags) {
    lines.push(tsvLine(includeDetails ? [summaryFlagRegularText(flag), summaryFlagDetailText(flag)] : [summaryFlagRegularText(flag)]));
  }

  return lines;
}

function summaryTabDisplayText(report: DoorknockResultsReport, includeMetrics = false): string {
  return (Object.entries(SUMMARY_LABELS) as Array<[DoorknockSummaryFlagKind, string]>)
    .map(([kind, label]) => summaryFlagsDisplayText(label, report.summary.flags[kind], includeMetrics))
    .join("\n\n");
}

function reportCsv(report: DoorknockResultsReport, reportName: string, includeDetails = false): string {
  const lines: string[] = [
    csvLine([reportName]),
    csvLine(["Report Date", formatDate(report.summary.reportDate)]),
    csvLine(["Campaigns", report.summary.campaignCount]),
    csvLine(["Doors Knocked", report.summary.totalDoorsKnocked]),
    csvLine(["Contacts", report.summary.totalContacts]),
    csvLine(["Contact Rate", formatPercent(report.summary.contactRate)]),
    csvLine([]),
    csvLine(["Summary"]),
    csvLine([]),
  ];

  for (const [kind, label] of Object.entries(SUMMARY_LABELS) as Array<[DoorknockSummaryFlagKind, string]>) {
    lines.push(...summaryFlagsCsvLines(label, report.summary.flags[kind], includeDetails));
    lines.push(csvLine([]));
  }

  for (const campaign of report.campaigns) {
    lines.push(campaignCsv(campaign));
    lines.push(csvLine([]));
  }

  return lines.join("\r\n");
}

function reportTsv(report: DoorknockResultsReport, reportName: string, includeDetails: boolean): string {
  const lines: string[] = [
    tsvLine([reportName]),
    tsvLine(["Report Date", formatDate(report.summary.reportDate)]),
    tsvLine(["Campaigns", report.summary.campaignCount]),
    tsvLine(["Doors Knocked", report.summary.totalDoorsKnocked]),
    tsvLine(["Contacts", report.summary.totalContacts]),
    tsvLine(["Contact Rate", formatPercent(report.summary.contactRate)]),
    tsvLine([]),
    tsvLine(["Summary"]),
    tsvLine([]),
  ];

  for (const [kind, label] of Object.entries(SUMMARY_LABELS) as Array<[DoorknockSummaryFlagKind, string]>) {
    lines.push(...summaryFlagsTsvLines(label, report.summary.flags[kind], includeDetails));
    lines.push(tsvLine([]));
  }

  for (const campaign of report.campaigns) {
    lines.push(campaignTsv(campaign));
    lines.push(tsvLine([]));
  }

  return lines.join("\n");
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

function nameMatchKeys(value: string): Set<string> {
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

function parseExcludedCanvassers(raw: string): Set<string> {
  const keys = new Set<string>();
  for (const entry of splitExcludedCanvasserEntries(raw)) {
    for (const key of nameMatchKeys(entry)) {
      keys.add(key);
    }
  }

  return keys;
}

function isExcludedCanvasser(name: string, excludedCanvassers: Set<string>): boolean {
  for (const key of nameMatchKeys(name)) {
    if (excludedCanvassers.has(key)) return true;
  }

  return false;
}

function emptyFlags(): DoorknockResultsReport["summary"]["flags"] {
  return {
    low_doors_low_support: [],
    low_contact_rate: [],
    survey_support_struggle: [],
    non_contact_outlier: [],
  };
}

function filterCampaignReport(
  campaign: DoorknockCampaignReport,
  keepName: (name: string) => boolean
): DoorknockCampaignReport {
  const rows = campaign.rows.filter((row) => keepName(row.canvasserName));
  const surveyAnswers = campaign.surveyGroups
    .flatMap((group) => group.columns)
    .reduce<Record<string, number>>((totals, column) => {
      totals[column.key] = rows.reduce((sum, row) => sum + (row.surveyAnswers[column.key] ?? 0), 0);
      return totals;
    }, {});
  const nonContacts = campaign.nonContactColumns.reduce<Record<string, number>>((totals, column) => {
    totals[column.key] = rows.reduce((sum, row) => sum + (row.nonContacts[column.key] ?? 0), 0);
    return totals;
  }, {});
  const doorsKnocked = rows.reduce((sum, row) => sum + row.doorsKnocked, 0);
  const contacts = rows.reduce((sum, row) => sum + row.contacts, 0);

  return {
    ...campaign,
    rows,
    totals: {
      doorsKnocked,
      contacts,
      contactRate: doorsKnocked > 0 ? contacts / doorsKnocked : 0,
      surveyAnswers,
      nonContacts,
    },
  };
}

function filterDoorknockReport(
  report: DoorknockResultsReport | null,
  excludedCanvassers: Set<string>
): DoorknockResultsReport | null {
  if (!report || excludedCanvassers.size === 0) return report;

  const keepName = (name: string) => !isExcludedCanvasser(name, excludedCanvassers);
  const campaigns = report.campaigns.map((campaign) => filterCampaignReport(campaign, keepName));
  const flags = (Object.keys(report.summary.flags) as DoorknockSummaryFlagKind[]).reduce<DoorknockResultsReport["summary"]["flags"]>(
    (nextFlags, kind) => {
      nextFlags[kind] = report.summary.flags[kind].filter((flag) => keepName(flag.canvasserName));
      return nextFlags;
    },
    emptyFlags()
  );
  const totalCanvassers = campaigns.reduce((sum, campaign) => sum + campaign.rows.length, 0);
  const totalDoorsKnocked = campaigns.reduce((sum, campaign) => sum + campaign.totals.doorsKnocked, 0);
  const totalContacts = campaigns.reduce((sum, campaign) => sum + campaign.totals.contacts, 0);

  return {
    ...report,
    campaigns,
    summary: {
      ...report.summary,
      totalCanvassers,
      totalDoorsKnocked,
      totalContacts,
      contactRate: totalDoorsKnocked > 0 ? totalContacts / totalDoorsKnocked : 0,
      flags,
    },
  };
}

function readPersistedState(): PersistedDoorknockResultsState {
  if (typeof window === "undefined") {
    return {
      reportName: "",
      result: null,
      activeReport: null,
      settings: DEFAULT_DOORKNOCK_SUMMARY_SETTINGS,
      excludedCanvassersRaw: "",
    };
  }
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return {
        reportName: "",
        result: null,
        activeReport: null,
        settings: DEFAULT_DOORKNOCK_SUMMARY_SETTINGS,
        excludedCanvassersRaw: "",
      };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedDoorknockResultsState>;
    return {
      reportName: typeof parsed.reportName === "string" ? parsed.reportName : "",
      result: parsed.result ?? null,
      activeReport: parsed.activeReport ?? null,
      settings: parsed.settings ?? DEFAULT_DOORKNOCK_SUMMARY_SETTINGS,
      excludedCanvassersRaw:
        typeof parsed.excludedCanvassersRaw === "string" ? parsed.excludedCanvassersRaw : "",
    };
  } catch {
    return {
      reportName: "",
      result: null,
      activeReport: null,
      settings: DEFAULT_DOORKNOCK_SUMMARY_SETTINGS,
      excludedCanvassersRaw: "",
    };
  }
}

function CopyMiniButton({ label = "Copy", onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 transition-all hover:bg-gray-50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-white/5"
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

function SummaryFlagList({
  title,
  flags,
  onCopyText,
  showDetails,
}: {
  title: string;
  flags: DoorknockSummaryFlag[];
  onCopyText: CopyTextHandler;
  showDetails: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">{title}</h3>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
            {flags.length}
          </span>
          <CopyMiniButton
            onClick={() => onCopyText(summaryFlagsDisplayText(title, flags, showDetails), `${title} copied.`)}
          />
        </div>
      </div>
      {flags.length ? (
        <ul className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300">
          {flags.slice(0, 25).map((flag, index) => (
            <li key={`${flag.kind}-${flag.campaignId}-${flag.canvasserName}-${index}`} className="rounded-xl bg-gray-50 p-3 dark:bg-white/5">
              <p>{summaryFlagRegularText(flag)}</p>
              {showDetails && summaryFlagDetailText(flag) ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {summaryFlagDetailText(flag)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No flags for this section.</p>
      )}
    </div>
  );
}

function SettingsPanel({
  settings,
  setSettings,
}: {
  settings: DoorknockSummarySettings;
  setSettings: React.Dispatch<React.SetStateAction<DoorknockSummarySettings>>;
}) {
  function updateNumber(key: keyof DoorknockSummarySettings, value: string) {
    setSettings((current) => ({ ...current, [key]: Number(value) }));
  }

  function updateCsvList(key: keyof DoorknockSummarySettings, value: string) {
    setSettings((current) => ({
      ...current,
      [key]: value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    }));
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Summary thresholds</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Low doors threshold</span>
          <input type="number" value={settings.lowDoorsThreshold} onChange={(e) => updateNumber("lowDoorsThreshold", e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Low doors max SS</span>
          <input type="number" value={settings.lowDoorsMaxStrongSupport} onChange={(e) => updateNumber("lowDoorsMaxStrongSupport", e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Low contact rate %</span>
          <input type="number" value={settings.lowContactRatePct} onChange={(e) => updateNumber("lowContactRatePct", e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Survey support threshold %</span>
          <input type="number" value={settings.surveySupportThresholdPct} onChange={(e) => updateNumber("surveySupportThresholdPct", e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Survey scope</span>
          <select value={settings.surveyQuestionScope} onChange={(e) => setSettings((current) => ({ ...current, surveyQuestionScope: e.target.value === "all" ? "all" : "first" }))} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950">
            <option value="first">First survey question</option>
            <option value="all">All survey questions</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Non-contact outlier multiplier</span>
          <input type="number" step="0.1" value={settings.nonContactOutlierMultiplier} onChange={(e) => updateNumber("nonContactOutlierMultiplier", e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950" />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Support answer labels</span>
          <input value={settings.supportAnswerLabels.join(", ")} onChange={(e) => updateCsvList("supportAnswerLabels", e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950" />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Ignored non-contact labels</span>
          <input value={settings.ignoredNonContactLabels.join(", ")} onChange={(e) => updateCsvList("ignoredNonContactLabels", e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950" />
        </label>
      </div>
    </div>
  );
}

function CampaignTable({
  campaign,
  onCopyText,
}: {
  campaign: DoorknockCampaignReport;
  onCopyText: CopyTextHandler;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const nonContactGroupId = "__non_contacts__";

  function toggleGroup(groupId: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function collapseAllGroups() {
    setCollapsedGroups(new Set([...campaign.surveyGroups.map((group) => group.question), nonContactGroupId]));
  }

  function expandAllGroups() {
    setCollapsedGroups(new Set());
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50">{campaign.campaignName}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {campaign.sourceFile.relativePath} / {formatDate(campaign.reportDate)}
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
          Detection {Math.round(campaign.detection.confidence * 100)}%
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onCopyText(campaignTsv(campaign), `${campaign.campaignName} copied for Sheets.`)}
          className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 transition-all hover:bg-emerald-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          Copy Table
        </button>
        <button type="button" onClick={collapseAllGroups} className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 transition-all hover:bg-gray-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15">
          Collapse columns
        </button>
        <button type="button" onClick={expandAllGroups} className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 transition-all hover:bg-gray-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15">
          Expand columns
        </button>
      </div>

      <div className="mt-4 max-h-[72vh] overflow-auto">
        <table className="w-max border-collapse table-fixed text-[11px]">
          <thead>
            <tr>
              <th rowSpan={2} className="sticky left-0 top-0 z-30 w-44 min-w-44 border border-gray-200 bg-gray-900 px-3 py-2 text-left font-semibold text-white dark:border-gray-700">Canvasser name</th>
              <th rowSpan={2} className="sticky top-0 z-20 w-20 min-w-20 border border-gray-200 bg-sky-700 px-2 py-2 text-white dark:border-gray-700">Doors</th>
              <th rowSpan={2} className="sticky top-0 z-20 w-20 min-w-20 border border-gray-200 bg-sky-700 px-2 py-2 text-white dark:border-gray-700">Contacts</th>
              <th rowSpan={2} className="sticky top-0 z-20 w-20 min-w-20 border border-gray-200 bg-sky-700 px-2 py-2 text-white dark:border-gray-700">Rate</th>
              {campaign.surveyGroups.map((group) => {
                const collapsed = collapsedGroups.has(group.question);
                return (
                <th
                  key={group.question}
                  colSpan={collapsed ? 1 : group.columns.length}
                  onClick={() => toggleGroup(group.question)}
                  className="sticky top-0 z-20 cursor-pointer select-none border border-gray-200 bg-violet-700 px-2 py-2 text-white transition hover:brightness-110 active:brightness-90 dark:border-gray-700"
                  title={collapsed ? "Click to expand" : "Click to collapse"}
                >
                  <span className="mx-auto block max-w-64 truncate" title={group.question}>
                    {group.question} <span className="opacity-75">{collapsed ? "▶" : "▾"}</span>
                  </span>
                </th>
              );
              })}
              {campaign.nonContactColumns.length ? (
                <th
                  colSpan={collapsedGroups.has(nonContactGroupId) ? 1 : campaign.nonContactColumns.length}
                  onClick={() => toggleGroup(nonContactGroupId)}
                  className="sticky top-0 z-20 cursor-pointer select-none border border-gray-200 bg-rose-700 px-2 py-2 text-white transition hover:brightness-110 active:brightness-90 dark:border-gray-700"
                  title={collapsedGroups.has(nonContactGroupId) ? "Click to expand" : "Click to collapse"}
                >
                  Non Contact <span className="opacity-75">{collapsedGroups.has(nonContactGroupId) ? "▶" : "▾"}</span>
                </th>
              ) : null}
            </tr>
            <tr>
              {campaign.surveyGroups.flatMap((group) => {
                if (collapsedGroups.has(group.question)) {
                  return [
                    <th key={`${group.question}-sum`} className="sticky top-[2.1rem] z-20 w-16 min-w-16 border border-gray-200 bg-violet-100 px-2 py-2 text-violet-900 dark:border-gray-700 dark:bg-violet-950/50 dark:text-violet-100">
                      Total
                    </th>,
                  ];
                }
                return group.columns.map((col) => (
                    <th key={col.key} className="sticky top-[2.1rem] z-20 w-20 min-w-20 border border-gray-200 bg-violet-100 px-1.5 py-1.5 text-violet-900 dark:border-gray-700 dark:bg-violet-950/50 dark:text-violet-100">
                      <span className="line-clamp-2 block leading-tight" title={col.answer}>
                        {col.answer}
                      </span>
                    </th>
                  ));
              })}
              {collapsedGroups.has(nonContactGroupId) ? (
                <th className="sticky top-[2.1rem] z-20 w-16 min-w-16 border border-gray-200 bg-rose-100 px-2 py-2 text-rose-900 dark:border-gray-700 dark:bg-rose-950/50 dark:text-rose-100">
                  Total
                </th>
              ) : (
                campaign.nonContactColumns.map((col) => (
                  <th key={col.key} className="sticky top-[2.1rem] z-20 w-20 min-w-20 border border-gray-200 bg-rose-100 px-1.5 py-1.5 text-rose-900 dark:border-gray-700 dark:bg-rose-950/50 dark:text-rose-100">
                    <span className="line-clamp-2 block leading-tight" title={col.label}>
                      {col.label}
                    </span>
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {campaign.rows.map((row, rowIndex) => (
              <tr key={row.canvasserName} className={rowIndex % 2 ? "bg-gray-50 dark:bg-white/5" : "bg-white dark:bg-gray-900"}>
                <td className="sticky left-0 z-10 border border-gray-200 bg-inherit px-3 py-2 font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">{row.canvasserName}</td>
                <td className="border border-gray-200 px-2 py-2 text-center tabular-nums dark:border-gray-700">{row.doorsKnocked}</td>
                <td className="border border-gray-200 px-2 py-2 text-center tabular-nums dark:border-gray-700">{row.contacts}</td>
                <td className="border border-gray-200 px-2 py-2 text-center tabular-nums dark:border-gray-700">{formatPercent(row.contactRate)}</td>
                {campaign.surveyGroups.flatMap((group) => {
                  if (collapsedGroups.has(group.question)) {
                    const total = group.columns.reduce((sum, col) => sum + (row.surveyAnswers[col.key] ?? 0), 0);
                    return [
                      <td key={`${row.canvasserName}-${group.question}-sum`} className="border border-gray-200 px-2 py-2 text-center tabular-nums dark:border-gray-700">
                        {total}
                      </td>,
                    ];
                  }
                  return group.columns.map((col) => (
                    <td key={`${row.canvasserName}-${col.key}`} className="border border-gray-200 px-2 py-2 text-center tabular-nums dark:border-gray-700">
                      {row.surveyAnswers[col.key] ?? 0}
                    </td>
                  ));
                })}
                {collapsedGroups.has(nonContactGroupId) ? (
                  <td className="border border-gray-200 px-2 py-2 text-center tabular-nums dark:border-gray-700">
                    {campaign.nonContactColumns.reduce((sum, col) => sum + (row.nonContacts[col.key] ?? 0), 0)}
                  </td>
                ) : campaign.nonContactColumns.map((col) => (
                  <td key={`${row.canvasserName}-${col.key}`} className="border border-gray-200 px-2 py-2 text-center tabular-nums dark:border-gray-700">
                    {row.nonContacts[col.key] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-gray-900 font-bold text-white">
              <td className="sticky left-0 z-10 border border-gray-700 bg-gray-900 px-3 py-2">Total</td>
              <td className="border border-gray-700 px-2 py-2 text-center">{campaign.totals.doorsKnocked}</td>
              <td className="border border-gray-700 px-2 py-2 text-center">{campaign.totals.contacts}</td>
              <td className="border border-gray-700 px-2 py-2 text-center">{formatPercent(campaign.totals.contactRate)}</td>
              {campaign.surveyGroups.flatMap((group) => {
                if (collapsedGroups.has(group.question)) {
                  const total = group.columns.reduce((sum, col) => sum + (campaign.totals.surveyAnswers[col.key] ?? 0), 0);
                  return [
                    <td key={`total-${group.question}-sum`} className="border border-gray-700 px-2 py-2 text-center">
                      {total}
                    </td>,
                  ];
                }
                return group.columns.map((col) => (
                  <td key={`total-${col.key}`} className="border border-gray-700 px-2 py-2 text-center">
                    {campaign.totals.surveyAnswers[col.key] ?? 0}
                  </td>
                ));
              })}
              {collapsedGroups.has(nonContactGroupId) ? (
                <td className="border border-gray-700 px-2 py-2 text-center">
                  {campaign.nonContactColumns.reduce((sum, col) => sum + (campaign.totals.nonContacts[col.key] ?? 0), 0)}
                </td>
              ) : campaign.nonContactColumns.map((col) => (
                <td key={`total-${col.key}`} className="border border-gray-700 px-2 py-2 text-center">
                  {campaign.totals.nonContacts[col.key] ?? 0}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DoorknocksResultsClient() {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => readPersistedState(), []);
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [settings, setSettings] = useState<DoorknockSummarySettings>(initial.settings);
  const [reportName, setReportName] = useState(initial.reportName);
  const [result, setResult] = useState<DoorknockResultsReport | null>(initial.result);
  const [activeReport, setActiveReport] = useState<SavedDoorknockResultsReport | null>(initial.activeReport);
  const [savedReports, setSavedReports] = useState<SavedDoorknockResultsListItem[]>([]);
  const [activeTab, setActiveTab] = useState(() => initial.activeReport?.campaigns[0]?.id ?? initial.result?.campaigns[0]?.id ?? "summary");
  const [excludedCanvassersRaw, setExcludedCanvassersRaw] = useState(initial.excludedCanvassersRaw);
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);
  const [loadingReports, setLoadingReports] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const rawCurrentReport = activeReport ?? result;
  const excludedCanvassers = useMemo(() => parseExcludedCanvassers(excludedCanvassersRaw), [excludedCanvassersRaw]);
  const currentReport = useMemo(
    () => filterDoorknockReport(rawCurrentReport, excludedCanvassers),
    [excludedCanvassers, rawCurrentReport]
  );
  const currentName = activeReport?.name || reportName || `Doorknocks results ${currentReport?.summary.reportDate ?? ""}`.trim();
  const excludedVisibleCount = rawCurrentReport
    ? rawCurrentReport.campaigns.reduce(
        (sum, campaign) =>
          sum + campaign.rows.filter((row) => isExcludedCanvasser(row.canvasserName, excludedCanvassers)).length,
        0
      )
    : 0;

  useEffect(() => {
    const input = folderInputRef.current;
    if (input) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch("/api/canvassing/doorknocks-results/reports", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<{ reports: SavedDoorknockResultsListItem[] }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to load saved doorknock reports.");
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
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ reportName, result, activeReport, settings, excludedCanvassersRaw })
    );
  }, [activeReport, excludedCanvassersRaw, reportName, result, settings]);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList) as FolderFile[];
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      const next = [...current];
      for (const file of incoming) {
        if (file.name.toLowerCase().endsWith(".csv") && !seen.has(fileKey(file))) next.push(file);
      }
      return next;
    });
    setResult(null);
    setActiveReport(null);
    setMessage("");
    setError("");
  }

  function buildFormData(): FormData {
    const form = new FormData();
    const relativePaths: string[] = [];
    for (const file of files) {
      form.append("files", file, file.name);
      relativePaths.push(filePath(file));
    }
    form.set("relativePaths", JSON.stringify(relativePaths));
    form.set("settings", JSON.stringify(settings));
    form.set("name", reportName);
    return form;
  }

  async function runReport() {
    setError("");
    setMessage("");
    if (!files.length) {
      setError("Choose a folder or CSV files first.");
      return;
    }

    setRunning(true);
    try {
      const res = await fetch("/api/canvassing/doorknocks-results/preview", { method: "POST", body: buildFormData() });
      const json = (await res.json()) as ApiResponse<{ result: DoorknockResultsReport }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to run doorknocks report.");
      setResult(json.data.result);
      setActiveReport(null);
      setActiveTab(json.data.result.campaigns[0]?.id ?? "summary");
      const nextName = `Doorknocks results ${formatDate(json.data.result.summary.reportDate)}`;
      setReportName(nextName);
      setMessage("Report run complete. Review the summary and campaign tabs, then save if needed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function saveReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!files.length) {
      setError("Choose a folder or CSV files first.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/canvassing/doorknocks-results/reports", { method: "POST", body: buildFormData() });
      const json = (await res.json()) as ApiResponse<{ report: SavedDoorknockResultsReport }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to save doorknocks report.");
      setActiveReport(json.data.report);
      setResult(null);
      setActiveTab(json.data.report.campaigns[0]?.id ?? "summary");
      setMessage("Report saved. It can be reopened without reuploading.");
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
      const res = await fetch(`/api/canvassing/doorknocks-results/reports/${encodeURIComponent(reportId)}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<{ report: SavedDoorknockResultsReport }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to open saved report.");
      setActiveReport(json.data.report);
      setResult(null);
      setSettings(json.data.report.settings);
      setReportName(json.data.report.name);
      setActiveTab(json.data.report.campaigns[0]?.id ?? "summary");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteReport(reportId: string) {
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/canvassing/doorknocks-results/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" });
      const json = (await res.json()) as ApiResponse<{ deleted: boolean }>;
      if (!json.ok) throw new Error(json.error || "Unable to delete report.");
      if (activeReport?.id === reportId) setActiveReport(null);
      setMessage("Saved report deleted.");
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function downloadCsv() {
    setError("");
    setMessage("");
    if (!currentReport) {
      setError("Run or open a report before downloading.");
      return;
    }
    const blob = new Blob([`\uFEFF${reportCsv(currentReport, currentName, showSummaryDetails)}`], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeCsvFileName(currentName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function copyCsv() {
    setError("");
    setMessage("");
    if (!currentReport) {
      setError("Run or open a report before copying.");
      return;
    }

    try {
      await navigator.clipboard.writeText(reportTsv(currentReport, currentName, showSummaryDetails));
      setMessage("Report copied for Sheets.");
    } catch {
      setError("Unable to copy CSV. Your browser may be blocking clipboard access.");
    }
  }

  async function copyTextToClipboard(text: string, successMessage: string) {
    setError("");
    setMessage("");
    try {
      await navigator.clipboard.writeText(text);
      setMessage(successMessage);
    } catch {
      setError("Unable to copy to clipboard. Your browser may be blocking clipboard access.");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-500 dark:text-emerald-300">
          Canvassing
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
          Doorknocks and Results
        </h1>
        <p className="mt-3 max-w-3xl text-gray-600 dark:text-gray-400">
          Upload a folder of PDI contact-report CSVs. Each file is inspected individually, survey
          questions are learned from its headers, and each campaign gets its own By Canvasser pivot.
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form onSubmit={saveReport} className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Report name</span>
            <input value={reportName} onChange={(event) => setReportName(event.target.value)} placeholder="Doorknocks results" className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950" />
          </label>

          <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 p-5 dark:border-emerald-800 dark:bg-emerald-950/20">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Upload folder or CSV files</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              The folder can contain one or more PDI contact report CSVs. Non-CSV files are ignored by the picker.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.98] focus-within:ring-2 focus-within:ring-emerald-400/60">
                Choose folder
                <input ref={folderInputRef} type="file" multiple accept=".csv" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)} />
              </label>
              <label className="inline-flex cursor-pointer items-center rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition-all hover:bg-emerald-50 active:scale-[0.98] focus-within:ring-2 focus-within:ring-emerald-400/60 dark:border-emerald-900 dark:bg-gray-950 dark:text-emerald-200 dark:hover:bg-emerald-950/30">
                Choose files
                <input type="file" multiple accept=".csv" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)} />
              </label>
              {files.length ? (
                <button type="button" onClick={() => setFiles([])} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5">
                  Clear selection
                </button>
              ) : null}
            </div>
            <div className="mt-4 rounded-xl bg-white p-3 text-sm text-gray-700 dark:bg-gray-950 dark:text-gray-300">
              <p className="font-medium">{files.length ? `${files.length} CSV files selected` : "No files selected"}</p>
              {files.length ? (
                <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-gray-500 dark:text-gray-400">
                  {files.map((file) => <li key={fileKey(file)}>{filePath(file)}</li>)}
                </ul>
              ) : null}
            </div>
          </div>

          <SettingsPanel settings={settings} setSettings={setSettings} />

          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Exclude canvasser exceptions
            </span>
            <textarea
              value={excludedCanvassersRaw}
              onChange={(event) => setExcludedCanvassersRaw(event.target.value)}
              rows={3}
              placeholder={"One name per line, e.g.\nJane Smith\nSmith, Jane\nSupervisor Name"}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100"
            />
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
              Add names before or after running a report. Matching ignores capitalization and first/last name order; use one name per line for comma-formatted names.
              {excludedVisibleCount > 0 ? ` ${excludedVisibleCount} matching row${excludedVisibleCount === 1 ? "" : "s"} currently excluded.` : ""}
            </span>
          </label>

          {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div> : null}
          {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</div> : null}

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void runReport()} disabled={running || saving || !files.length} className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition-all hover:bg-emerald-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 dark:border-emerald-900 dark:bg-gray-950 dark:text-emerald-200">
              {running ? "Running..." : "Run Report"}
            </button>
            <button type="submit" disabled={running || saving || !files.length} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100">
              {saving ? "Saving..." : "Save report"}
            </button>
            <button type="button" onClick={downloadCsv} disabled={!currentReport} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5">
              Download report CSV
            </button>
            <button type="button" onClick={() => void copyCsv()} disabled={!currentReport} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5">
              Copy for Sheets
            </button>
          </div>
        </form>

        <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Saved reports</h2>
            <button type="button" onClick={() => void loadReports()} className="rounded-lg px-2 py-1 text-sm font-semibold text-emerald-700 transition-all hover:bg-emerald-50 hover:text-emerald-900 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:text-emerald-300 dark:hover:bg-white/5">Refresh</button>
          </div>
          <div className="mt-4 space-y-3">
            {loadingReports ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading reports...</p> : null}
            {!loadingReports && !savedReports.length ? <p className="text-sm text-gray-500 dark:text-gray-400">No reports saved yet.</p> : null}
            {savedReports.map((report) => (
              <div key={report.id} className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                <button type="button" onClick={() => void openReport(report.id)} className="block w-full rounded-lg p-2 text-left transition-all hover:bg-gray-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:hover:bg-white/5">
                  <p className="font-semibold text-gray-900 dark:text-gray-50">{report.name}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(report.summary.reportDate)} / {report.summary.campaignCount} campaigns / {formatNumber(report.summary.totalDoorsKnocked)} doors
                  </p>
                </button>
                <button type="button" onClick={() => void deleteReport(report.id)} className="mt-2 rounded-md px-1.5 py-1 text-xs font-semibold text-red-600 transition-all hover:bg-red-50 hover:text-red-800 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 dark:text-red-300 dark:hover:bg-red-950/30">
                  Delete
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {currentReport ? (
        <section className="space-y-6">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
            <label className="block">
              <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                Adjust canvasser exceptions for this report
              </span>
              <textarea
                value={excludedCanvassersRaw}
                onChange={(event) => setExcludedCanvassersRaw(event.target.value)}
                rows={2}
                placeholder={"Jane Smith\nSmith, Jane"}
                className="mt-2 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-emerald-900 dark:bg-gray-950 dark:text-gray-100"
              />
            </label>
            <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
              Updates tables, summary boxes, summary flag lists, and exports immediately.
              {excludedVisibleCount > 0 ? ` ${excludedVisibleCount} matching row${excludedVisibleCount === 1 ? "" : "s"} excluded.` : ""}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Campaigns",
                value: formatNumber(currentReport.summary.campaignCount),
                help: formatDate(currentReport.summary.reportDate),
              },
              {
                label: "Doors knocked",
                value: formatNumber(currentReport.summary.totalDoorsKnocked),
              },
              {
                label: "Contacts",
                value: formatNumber(currentReport.summary.totalContacts),
              },
              {
                label: "Contact rate",
                value: formatPercent(currentReport.summary.contactRate),
              },
            ].map((tile) => (
              <StatTile
                key={tile.label}
                label={tile.label}
                value={tile.value}
                help={tile.help}
                onCopy={() => void copyTextToClipboard(summaryBoxCsv(tile.label, tile.value, tile.help), `${tile.label} copied.`)}
              />
            ))}
          </div>

          {currentReport.validationIssues.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {currentReport.validationIssues.slice(0, 8).map((issue) => <p key={issue}>{issue}</p>)}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {currentReport.campaigns.map((campaign) => (
              <button key={campaign.id} type="button" onClick={() => setActiveTab(campaign.id)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${activeTab === campaign.id ? "bg-emerald-600 text-white shadow-sm" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"}`}>
                {campaign.campaignName}
              </button>
            ))}
            <button type="button" onClick={() => setActiveTab("summary")} className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${activeTab === "summary" ? "bg-emerald-600 text-white shadow-sm" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"}`}>
              Summary
            </button>
          </div>

          {activeTab === "summary" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.98] dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={showSummaryDetails}
                    onChange={(event) => setShowSummaryDetails(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Show full details
                </label>
                <button
                  type="button"
                  onClick={() => void copyTextToClipboard(summaryTabDisplayText(currentReport, showSummaryDetails), "Summary tab copied.")}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
                >
                  Copy Summary
                </button>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {(Object.entries(SUMMARY_LABELS) as Array<[DoorknockSummaryFlagKind, string]>).map(([kind, label]) => (
                  <SummaryFlagList
                    key={kind}
                    title={label}
                    flags={currentReport.summary.flags[kind]}
                    onCopyText={(text, successMessage) => void copyTextToClipboard(text, successMessage)}
                  showDetails={showSummaryDetails}
                  />
                ))}
              </div>
            </div>
          ) : (
            currentReport.campaigns
              .filter((campaign) => campaign.id === activeTab)
              .map((campaign) => (
                <CampaignTable
                  key={campaign.id}
                  campaign={campaign}
                  onCopyText={(text, successMessage) => void copyTextToClipboard(text, successMessage)}
                />
              ))
          )}
        </section>
      ) : null}
    </div>
  );
}
