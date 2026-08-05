"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { writeTextToClipboard } from "@/lib/browser-clipboard";
import { buildDisplayNameMap, displayNameFor } from "@/lib/canvassing/display-names";
import { emptyGapHistogram, histogramToPct } from "@/lib/canvassing/non-contact-patterns/histogram";
import {
  DEFAULT_NON_CONTACT_PATTERN_SETTINGS,
  type CanvasserAnomalyScore,
  type CanvasserPatternSummary,
  type EnrichedKnockRow,
  type NonContactPatternIngestionResult,
  type NonContactPatternResult,
  type NonContactPatternSettings,
  type SavedNonContactPatternListItem,
  type SavedNonContactPatternReport,
  type TeamBaseline,
} from "@/lib/canvassing/non-contact-patterns/types";

const NonContactBaselineCharts = dynamic(() => import("./NonContactBaselineCharts"), { ssr: false });

type ApiResponse<T> = { ok: boolean; data?: T; error?: string };

type TabId = "summary" | "flagged-nc" | "flagged-c" | "details" | "baselines";

const SESSION_KEY = "canvassing.nonContactPatterns.v1";

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number | null, insufficient?: boolean): string {
  if (insufficient || value === null) return "insufficient sample";
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

function tsvCell(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).replace(/[\t\r\n]+/g, " ").trim();
}

function tsvLine(values: Array<string | number | boolean | null | undefined>): string {
  return values.map(tsvCell).join("\t");
}

function normalizeNameText(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N},\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function nameTokens(value: string): string[] {
  return normalizeNameText(value).replace(/,/g, " ").split(/\s+/).filter(Boolean);
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

function parseExcludedCanvassers(raw: string): Set<string> {
  const keys = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const key of nameMatchKeys(trimmed)) keys.add(key);
  }
  return keys;
}

function isExcludedCanvasser(name: string, excluded: Set<string>): boolean {
  for (const key of nameMatchKeys(name)) {
    if (excluded.has(key)) return true;
  }
  return false;
}

function filterResult(
  result: NonContactPatternResult | null,
  excluded: Set<string>
): NonContactPatternResult | null {
  if (!result || excluded.size === 0) return result;
  const keep = (name: string) => !isExcludedCanvasser(name, excluded);
  const enrichedRows = result.enrichedRows.filter((r) => keep(r.canvasserName));
  const canvasserSummaries = result.canvasserSummaries.filter((s) => keep(s.canvasserName));
  const flaggedNonContactRows = result.flaggedNonContactRows.filter((r) => keep(r.canvasserName));
  const flaggedContactRows = result.flaggedContactRows.filter((r) => keep(r.canvasserName));
  return {
    ...result,
    enrichedRows,
    canvasserSummaries,
    flaggedNonContactRows,
    flaggedContactRows,
    summary: {
      ...result.summary,
      totalRows: enrichedRows.length,
      totalCanvassers: canvasserSummaries.length,
      rapidNonContactFlagCount: enrichedRows.filter((r) => r.rapidNonContactFlag).length,
      rapidContactFlagCount: flaggedContactRows.length,
      streakAlertCanvasserCount: canvasserSummaries.filter((s) => s.streakAlert).length,
      burstAlertCanvasserCount: canvasserSummaries.filter((s) => s.burstAlert).length,
    },
  };
}

type SortKey = keyof CanvasserPatternSummary | "anomalyTier" | "compositeScore";

export default function NonContactPatternsClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [settings, setSettings] = useState<NonContactPatternSettings>(DEFAULT_NON_CONTACT_PATTERN_SETTINGS);
  const [reportName, setReportName] = useState("");
  const [result, setResult] = useState<NonContactPatternResult | null>(null);
  const [ingestionMeta, setIngestionMeta] = useState<{ splitByDate: boolean; distinctDates: string[] } | null>(null);
  const [activeReport, setActiveReport] = useState<SavedNonContactPatternReport | null>(null);
  const [savedReports, setSavedReports] = useState<SavedNonContactPatternListItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [excludedCanvassersRaw, setExcludedCanvassersRaw] = useState("");
  const [loadingReports, setLoadingReports] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rapidNonContactCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedCanvasser, setSelectedCanvasser] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<TeamBaseline | null>(null);
  const [canvasserScores, setCanvasserScores] = useState<CanvasserAnomalyScore[]>([]);
  const [baselineBanner, setBaselineBanner] = useState<string | null>(null);
  const [trend, setTrend] = useState<
    Array<{ reportDate: string; reportId: string; rapidNonContactFlagCount: number; flaggedCanvasserCount: number }>
  >([]);
  const [historyAsOf, setHistoryAsOf] = useState<string | null>(null);
  const [historyDays, setHistoryDays] = useState(21);

  const excluded = useMemo(() => parseExcludedCanvassers(excludedCanvassersRaw), [excludedCanvassersRaw]);
  const rawCurrent = activeReport ?? result;
  const currentReport = useMemo(() => filterResult(rawCurrent, excluded), [rawCurrent, excluded]);
  const displayNames = useMemo(
    () =>
      buildDisplayNameMap([
        ...(currentReport?.canvasserSummaries.map((s) => s.canvasserName) ?? []),
        ...(currentReport?.flaggedNonContactRows.map((r) => r.canvasserName) ?? []),
        ...(currentReport?.flaggedContactRows.map((r) => r.canvasserName) ?? []),
      ]),
    [currentReport]
  );
  const scoreByName = useMemo(
    () => new Map(canvasserScores.map((s) => [s.canvasserName, s])),
    [canvasserScores]
  );
  const latestSavedReportDate = useMemo(() => {
    const dates = savedReports.map((r) => r.reportDate).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1]! : null;
  }, [savedReports]);

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch("/api/canvassing/non-contact-patterns/reports", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<{ reports: SavedNonContactPatternListItem[] }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to load reports.");
      setSavedReports(json.data.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingReports(false);
    }
  }, []);

  const loadBaseline = useCallback(async (opts?: { reportId?: string | null; asOf?: string | null }) => {
    try {
      const params = new URLSearchParams();
      params.set("days", "21");
      if (opts?.reportId) params.set("reportId", opts.reportId);
      if (opts?.asOf) params.set("asOf", opts.asOf);
      const res = await fetch(`/api/canvassing/non-contact-patterns/baseline?${params}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiResponse<{
        baseline: TeamBaseline;
        canvasserScores?: CanvasserAnomalyScore[];
        banner: string | null;
        asOf?: string;
        days?: number;
        trend: Array<{
          reportDate: string;
          reportId: string;
          rapidNonContactFlagCount: number;
          flaggedCanvasserCount: number;
        }>;
      }>;
      if (!json.ok || !json.data) return;
      setBaseline(json.data.baseline);
      setCanvasserScores(json.data.canvasserScores ?? []);
      setBaselineBanner(json.data.banner);
      setTrend(json.data.trend ?? []);
      setHistoryAsOf(json.data.asOf ?? opts?.asOf ?? null);
      setHistoryDays(json.data.days ?? 21);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    const asOf =
      activeReport?.reportDate ||
      result?.summary.detectedReportDate ||
      latestSavedReportDate ||
      null;
    void loadBaseline({ reportId: activeReport?.id ?? null, asOf });
  }, [
    activeReport?.id,
    activeReport?.reportDate,
    latestSavedReportDate,
    loadBaseline,
    result?.summary.detectedReportDate,
  ]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ reportName, settings, excludedCanvassersRaw, activeTab })
      );
    } catch {
      // ignore quota
    }
  }, [reportName, settings, excludedCanvassersRaw, activeTab]);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    setFiles(Array.from(fileList));
    setResult(null);
    setActiveReport(null);
    setIngestionMeta(null);
    setMessage("");
    setError("");
  }

  function buildFormData(): FormData {
    const form = new FormData();
    const relativePaths: string[] = [];
    for (const file of files) {
      form.append("files", file, file.name);
      relativePaths.push(file.name);
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
      setError("Choose a CSV or XLSX knock-detail file first.");
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/canvassing/non-contact-patterns/preview", {
        method: "POST",
        body: buildFormData(),
      });
      const json = (await res.json()) as ApiResponse<{
        ingestion: NonContactPatternIngestionResult;
        result: NonContactPatternResult;
      }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to run analysis.");
      setResult(json.data.result);
      setActiveReport(null);
      setIngestionMeta({
        splitByDate: json.data.ingestion.splitByDate,
        distinctDates: json.data.ingestion.distinctDates,
      });
      const date = json.data.result.summary.detectedReportDate;
      setReportName(`Non-contact patterns ${formatDate(date)}`);
      setActiveTab("summary");
      const splitNote = json.data.ingestion.splitByDate
        ? ` Multi-day file detected (${json.data.ingestion.distinctDates.length} dates) — save will create one report per date.`
        : "";
      setMessage(`Analysis complete.${splitNote}`);
      void loadBaseline({ reportId: null, asOf: date });
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
      setError("Choose a file first.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/canvassing/non-contact-patterns/reports", {
        method: "POST",
        body: buildFormData(),
      });
      const json = (await res.json()) as ApiResponse<{
        reports: SavedNonContactPatternReport[];
        report: SavedNonContactPatternReport;
        splitByDate: boolean;
        distinctDates: string[];
      }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to save report.");
      setActiveReport(json.data.report);
      setResult(null);
      setIngestionMeta({ splitByDate: json.data.splitByDate, distinctDates: json.data.distinctDates });
      setMessage(
        json.data.splitByDate
          ? `Saved ${json.data.reports.length} day reports (${json.data.distinctDates.join(", ")}).`
          : "Report saved. History updated for baselines."
      );
      await loadReports();
      await loadBaseline({
        reportId: json.data.report.id,
        asOf: json.data.report.reportDate,
      });
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
      const res = await fetch(`/api/canvassing/non-contact-patterns/reports/${encodeURIComponent(reportId)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiResponse<{ report: SavedNonContactPatternReport }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to open report.");
      setActiveReport(json.data.report);
      setResult(null);
      setSettings({
        ...DEFAULT_NON_CONTACT_PATTERN_SETTINGS,
        ...json.data.report.summary.settings,
      });
      setReportName(json.data.report.name);
      setActiveTab("summary");
      await loadBaseline({
        reportId,
        asOf: json.data.report.reportDate,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteReport(reportId: string) {
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/canvassing/non-contact-patterns/reports/${encodeURIComponent(reportId)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as ApiResponse<{ deleted: boolean }>;
      if (!json.ok) throw new Error(json.error || "Unable to delete.");
      if (activeReport?.id === reportId) setActiveReport(null);
      setMessage("Saved report deleted.");
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyText(text: string, success: string) {
    try {
      await writeTextToClipboard(text);
      setMessage(success);
    } catch {
      setError("Unable to copy to clipboard.");
    }
  }

  function sortedSummaries(): CanvasserPatternSummary[] {
    if (!currentReport) return [];
    const rows = [...currentReport.canvasserSummaries];
    rows.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortKey === "anomalyTier") {
        av = scoreByName.get(a.canvasserName)?.anomalyTier ?? 99;
        bv = scoreByName.get(b.canvasserName)?.anomalyTier ?? 99;
      } else if (sortKey === "compositeScore") {
        av = scoreByName.get(a.canvasserName)?.compositeScore ?? 0;
        bv = scoreByName.get(b.canvasserName)?.compositeScore ?? 0;
      } else {
        const rawA = a[sortKey as keyof CanvasserPatternSummary] as
          | number
          | string
          | boolean
          | null
          | Record<string, number>
          | undefined;
        const rawB = b[sortKey as keyof CanvasserPatternSummary] as
          | number
          | string
          | boolean
          | null
          | Record<string, number>
          | undefined;
        if (typeof rawA === "boolean") av = rawA ? 1 : 0;
        else if (rawA === null || rawA === undefined || typeof rawA === "object") av = -1;
        else av = rawA;
        if (typeof rawB === "boolean") bv = rawB ? 1 : 0;
        else if (rawB === null || rawB === undefined || typeof rawB === "object") bv = -1;
        else bv = rawB;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return rows;
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "canvasserName" ? "asc" : "desc");
    }
  }

  function summaryTsv(): string {
    if (!currentReport) return "";
      const lines = [
      tsvLine([
        "Canvasser",
        "Total Rows",
        "Non-Contact",
        "Rapid NC",
        "Rate",
        "Longest Streak",
        "Burst Max",
        "Burst Alert",
        "Response Uniformity",
        "Rapid Contact",
        "Tier",
        "Score",
      ]),
    ];
    for (const s of sortedSummaries()) {
      const score = scoreByName.get(s.canvasserName);
      lines.push(
        tsvLine([
          s.canvasserName,
          s.totalRows,
          s.nonContactRowCount,
          s.rapidNonContactCount,
          formatPercent(s.rapidNonContactRate, s.rateSampleInsufficient),
          s.longestRapidNonContactStreak,
          s.maxBurstCount,
          s.burstAlert,
          s.dominantRapidResponseShare === null
            ? ""
            : formatPercent(s.dominantRapidResponseShare),
          s.rapidContactCount,
          score?.anomalyTier ?? "",
          score?.compositeScore ?? "",
        ])
      );
    }
    return lines.join("\n");
  }

  function flaggedTsv(rows: EnrichedKnockRow[]): string {
    const lines = [
      tsvLine(["Canvasser", "Voter", "Gap (s)", "Streak", "In Burst", "Datetime", "Phone", "Response"]),
    ];
    for (const r of rows) {
      lines.push(
        tsvLine([
          r.canvasserName,
          r.voter,
          r.gapToNextSeconds,
          r.streakLength,
          r.inBurstFlag,
          r.dateTimeRaw,
          r.phone,
          r.response,
        ])
      );
    }
    return lines.join("\n");
  }

  function summaryListText(): string {
    if (!currentReport) return "";
    const rows = sortedSummaries();
    const lines = [`Canvasser Summary (${rows.length})`, ""];
    if (!rows.length) {
      lines.push("None.");
      return lines.join("\n");
    }
    for (const s of rows) {
      const score = scoreByName.get(s.canvasserName);
      const rate = formatPercent(s.rapidNonContactRate, s.rateSampleInsufficient);
      const tier = score?.anomalyTier ?? "—";
      const scoreVal = score?.compositeScore ?? "—";
      const streakNote = s.streakAlert ? " · streak alert" : "";
      const burstNote = s.burstAlert ? ` · burst ${s.maxBurstCount}` : "";
      lines.push(
        `- ${s.canvasserName} — rapid NC ${s.rapidNonContactCount} (${rate}), streak ${s.longestRapidNonContactStreak}, rapid contact ${s.rapidContactCount}, tier ${tier}, score ${scoreVal}${streakNote}${burstNote}`
      );
    }
    return lines.join("\n");
  }

  function flaggedListText(title: string, rows: EnrichedKnockRow[], showStreak: boolean): string {
    const lines = [`${title} (${rows.length})`, ""];
    if (!rows.length) {
      lines.push("None.");
      return lines.join("\n");
    }
    for (const r of rows) {
      const gap =
        r.gapToNextSeconds === null || r.gapToNextSeconds === undefined
          ? "n/a"
          : `${Math.round(r.gapToNextSeconds)}s`;
      const streakPart = showStreak ? ` · streak ${r.streakLength}` : "";
      const burstPart = r.inBurstFlag ? " · burst" : "";
      lines.push(
        `- ${r.canvasserName} — ${r.voter || "unknown voter"} · gap ${gap}${streakPart}${burstPart} · ${r.dateTimeRaw || "n/a"} · ${r.response || "n/a"}`
      );
    }
    return lines.join("\n");
  }

  const teamHistPct = baseline?.teamGapHistogramPct ?? emptyGapHistogram();
  const currentHistPct = currentReport?.metricsSnapshot
    ? histogramToPct(currentReport.metricsSnapshot.teamGapHistogram)
    : emptyGapHistogram();
  const selectedSummary = currentReport?.canvasserSummaries.find((s) => s.canvasserName === selectedCanvasser);
  const canvasserHistPct = selectedSummary ? histogramToPct(selectedSummary.gapHistogram) : null;

  const topRates = (currentReport?.canvasserSummaries ?? [])
    .filter((s) => s.rapidNonContactRate !== null)
    .sort((a, b) => (b.rapidNonContactRate ?? 0) - (a.rapidNonContactRate ?? 0))
    .slice(0, 10)
    .map((s) => ({
      name: s.canvasserName,
      shortName: s.canvasserName.length > 16 ? `${s.canvasserName.slice(0, 14)}…` : s.canvasserName,
      ratePct: Number(((s.rapidNonContactRate ?? 0) * 100).toFixed(1)),
    }));

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "summary", label: "Canvasser Summary" },
    { id: "flagged-nc", label: "Flagged Non-Contact" },
    { id: "flagged-c", label: "Flagged Contact" },
    { id: "details", label: "Canvasser Details" },
    { id: "baselines", label: "Baselines & Charts" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500 dark:text-orange-300">
          Canvassing
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
          Non-Contact Patterns
        </h1>
        <p className="mt-3 max-w-3xl text-gray-600 dark:text-gray-400">
          Flag rapid consecutive non-contact marks that can suggest mass-marking doors without contact, then compare
          canvassers to recent team baselines. Scores prioritize review only — they are not findings of fact; human
          verification is required before any personnel action.
        </p>
        <ul className="mt-3 max-w-3xl list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Upload</span> — PDI Canvasser Details
            CSV/XLSX with second-level timestamps (not minute-only exports).
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Rapid non-contact</span> — consecutive
            Non-Contact Mobile rows within the max seconds (default {settings.rapidNonContactMaxSeconds}s), excluding
            same-household pairs.
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Rapid contact / streak</span> — short gaps
            into a contact (default {settings.rapidContactMaxSeconds}s) and streak alerts at{" "}
            {settings.streakAlertMin}+ rapid non-contacts.
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Burst</span> — {settings.burstMinMarks}+
            distinct-household Non-Contact marks inside {settings.burstWindowSeconds}s (catches tap-pause patterns that
            break pairwise streaks).
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Baselines</span> — need saved multi-day
            history; anomaly tiers are review prioritization aids only.
          </li>
          <li>
            <span className="font-medium text-gray-800 dark:text-gray-200">Exclude leads</span> — hide irregular
            schedules from pattern tables while keeping the saved report intact.
          </li>
        </ul>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          onSubmit={saveReport}
          className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900"
        >
          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Report name</span>
            <input
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
            />
          </label>

          <div className="rounded-2xl border border-dashed border-orange-300 bg-orange-50/60 p-5 dark:border-orange-800 dark:bg-orange-950/20">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Upload Canvasser Details</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Use the raw PDI knock-detail export (CANVASSERNAME through RESPONSE) with second-level times. A single
              day file is typical; multi-day gap-fill files are split into one saved report per date automatically.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-orange-700">
                Choose file
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  className="sr-only"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)}
                />
              </label>
              {files.length ? (
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
              {files.length ? files.map((f) => f.name).join(", ") : "No file selected"}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Rapid non-contact max (s)</span>
              <input
                type="number"
                value={settings.rapidNonContactMaxSeconds}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, rapidNonContactMaxSeconds: Number(e.target.value) || 15 }))
                }
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Max gap between consecutive Non-Contact Mobile rows to count as rapid.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Rapid contact max (s)</span>
              <input
                type="number"
                value={settings.rapidContactMaxSeconds}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, rapidContactMaxSeconds: Number(e.target.value) || 30 }))
                }
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Max gap into a likely contact used for the rapid-contact counter.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Streak alert min</span>
              <input
                type="number"
                value={settings.streakAlertMin}
                onChange={(e) => setSettings((s) => ({ ...s, streakAlertMin: Number(e.target.value) || 4 }))}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Highlight canvassers whose longest rapid non-contact streak reaches this length.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Burst window (s)</span>
              <input
                type="number"
                value={settings.burstWindowSeconds}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, burstWindowSeconds: Number(e.target.value) || 90 }))
                }
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Rolling window length for burst density.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Burst min marks</span>
              <input
                type="number"
                value={settings.burstMinMarks}
                onChange={(e) => setSettings((s) => ({ ...s, burstMinMarks: Number(e.target.value) || 5 }))}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Distinct-household NC marks in the window to raise a burst alert.
              </span>
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Exclude canvasser exceptions</span>
            <textarea
              value={excludedCanvassersRaw}
              onChange={(e) => setExcludedCanvassersRaw(e.target.value)}
              rows={2}
              placeholder={"One name per line, e.g.\nJane Smith\nSmith, Jane"}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
            />
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
              Accepts First Last or Last, First. Hides matching canvassers from pattern tables; saved reports keep full data.
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
              onClick={() => void runReport()}
              disabled={running || saving || !files.length}
              className="rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm font-semibold text-orange-700 disabled:opacity-60 dark:border-orange-900 dark:bg-gray-950 dark:text-orange-200"
            >
              {running ? "Running..." : "Run analysis"}
            </button>
            <button
              type="submit"
              disabled={running || saving || !files.length}
              className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save report"}
            </button>
            {activeReport ? (
              <a
                href={`/api/canvassing/non-contact-patterns/reports/${encodeURIComponent(activeReport.id)}/export`}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200"
              >
                Download Excel
              </a>
            ) : null}
          </div>
        </form>

        <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Saved reports</h2>
            <button
              type="button"
              onClick={() => void loadReports()}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-orange-700 dark:text-orange-300"
            >
              Refresh
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Voter-level PII is retained ~90 days for spot-checks; metrics snapshots are kept for baselines. Anyone with
            /canvassing access can see these scores.
          </p>
          <div className="mt-4 space-y-3">
            {loadingReports ? <p className="text-sm text-gray-500">Loading...</p> : null}
            {!loadingReports && !savedReports.length ? (
              <p className="text-sm text-gray-500">No reports saved yet.</p>
            ) : null}
            {savedReports.map((report) => (
              <div key={report.id} className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => void openReport(report.id)}
                  className="block w-full rounded-lg p-2 text-left hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  <p className="font-semibold text-gray-900 dark:text-gray-50">{report.name}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {formatDate(report.reportDate)} / {formatNumber(report.summary.rapidNonContactFlagCount)} rapid NC
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteReport(report.id)}
                  className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {currentReport ? (
        <section className="space-y-6">
          {currentReport.summary.resolutionWarning ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {currentReport.summary.resolutionWarning}
            </div>
          ) : null}

          {ingestionMeta?.splitByDate ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
              Multi-day upload dates: {ingestionMeta.distinctDates.join(", ")}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "Report date", value: formatDate(currentReport.summary.detectedReportDate) },
              { label: "Rapid non-contact flags", value: formatNumber(currentReport.summary.rapidNonContactFlagCount) },
              { label: "Streak alerts", value: formatNumber(currentReport.summary.streakAlertCanvasserCount) },
              {
                label: "Burst alerts",
                value: formatNumber(currentReport.summary.burstAlertCanvasserCount ?? 0),
              },
              {
                label: "Resolution",
                value: currentReport.summary.timestampResolution,
              },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-gray-900"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{tile.label}</p>
                <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-50">{tile.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
            Anomaly scores and tiers are a <strong>review-prioritization aid</strong>, not a finding of fact. Verify
            flagged rows manually before any personnel action. Rapid contact flags are lower confidence (multi-question
            surveys can trip them). Rates need ≥10 non-contact gaps for a canvasser-day.
          </div>

          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  activeTab === tab.id
                    ? "bg-orange-600 text-white"
                    : "border border-gray-200 bg-white text-gray-700 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "summary" ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
              <div className="mb-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void copyText(summaryListText(), "Summary list copied.")}
                  className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold dark:border-white/10"
                >
                  Copy as list
                </button>
                <button
                  type="button"
                  onClick={() => void copyText(summaryTsv(), "Summary copied.")}
                  className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold dark:border-white/10"
                >
                  Copy table
                </button>
              </div>
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-gray-900 text-left text-white">
                      {(
                        [
                          ["canvasserName", "Canvasser"],
                          ["rapidNonContactCount", "Rapid NC"],
                          ["longestRapidNonContactStreak", "Streak"],
                          ["maxBurstCount", "Burst Max"],
                          ["rapidNonContactRate", "Rate"],
                          ["rapidContactCount", "Rapid Contact"],
                          ["anomalyTier", "Tier"],
                          ["compositeScore", "Score"],
                        ] as Array<[SortKey, string]>
                      ).map(([key, label]) => (
                        <th key={key} className="cursor-pointer bg-gray-900 px-3 py-2" onClick={() => toggleSort(key)}>
                          {label}
                          {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSummaries().map((s) => {
                      const score = scoreByName.get(s.canvasserName);
                      return (
                        <tr
                          key={s.canvasserName}
                          className={`border-b border-gray-100 dark:border-white/5 ${
                            s.streakAlert || s.burstAlert ? "bg-red-50 dark:bg-red-950/20" : ""
                          } ${selectedCanvasser === s.canvasserName ? "ring-1 ring-orange-400" : ""}`}
                          onClick={() => setSelectedCanvasser(s.canvasserName)}
                        >
                          <td className="px-3 py-2 font-medium" title={s.canvasserName}>
                            {displayNameFor(s.canvasserName, displayNames)}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{s.rapidNonContactCount}</td>
                          <td className="px-3 py-2 tabular-nums">{s.longestRapidNonContactStreak}</td>
                          <td
                            className="px-3 py-2 tabular-nums"
                            title={s.burstAlert ? "Burst alert" : undefined}
                          >
                            {s.maxBurstCount ?? 0}
                            {s.burstAlert ? " !" : ""}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatPercent(s.rapidNonContactRate, s.rateSampleInsufficient)}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{s.rapidContactCount}</td>
                          <td className="px-3 py-2">{score?.anomalyTier ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{score?.compositeScore ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === "flagged-nc" ? (
            <FlaggedTable
              rows={currentReport.flaggedNonContactRows}
              title="Flagged Non-Contact"
              displayNames={displayNames}
              onCopyList={() =>
                void copyText(
                  flaggedListText("Flagged Non-Contact", currentReport.flaggedNonContactRows, true),
                  "Flagged non-contact list copied."
                )
              }
              onCopyTable={() =>
                void copyText(flaggedTsv(currentReport.flaggedNonContactRows), "Flagged non-contact copied.")
              }
            />
          ) : null}

          {activeTab === "flagged-c" ? (
            <FlaggedTable
              rows={currentReport.flaggedContactRows}
              title="Flagged Contact (lower confidence)"
              showStreak={false}
              displayNames={displayNames}
              onCopyList={() =>
                void copyText(
                  flaggedListText("Flagged Contact", currentReport.flaggedContactRows, false),
                  "Flagged contact list copied."
                )
              }
              onCopyTable={() =>
                void copyText(flaggedTsv(currentReport.flaggedContactRows), "Flagged contact copied.")
              }
            />
          ) : null}

          {activeTab === "details" ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
              <p className="mb-3 text-sm text-gray-500">
                Showing {Math.min(500, currentReport.enrichedRows.length)} of {currentReport.enrichedRows.length} rows
                (cap for UI performance).
              </p>
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[1100px] border-collapse text-xs">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-gray-900 text-white">
                      {[
                        "Canvasser",
                        "Voter",
                        "Gap s",
                        "HH?",
                        "Rapid NC",
                        "Streak",
                        "Burst",
                        "Rapid C",
                        "Datetime",
                        "Response",
                        "Question",
                      ].map((h) => (
                        <th key={h} className="bg-gray-900 px-2 py-2 text-left">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentReport.enrichedRows.slice(0, 500).map((r) => (
                      <tr
                        key={`${r.canvasserName}-${r.sourceRowNumber}-${r.occurredAt}`}
                        className={`border-b border-gray-100 dark:border-white/5 ${
                          r.rapidNonContactFlag || r.inBurstFlag ? "bg-red-50 dark:bg-red-950/20" : ""
                        }`}
                      >
                        <td className="px-2 py-1" title={r.canvasserName}>
                          {displayNameFor(r.canvasserName, displayNames)}
                        </td>
                        <td className="px-2 py-1">{r.voter}</td>
                        <td className="px-2 py-1 tabular-nums">
                          {r.gapToNextSeconds === null ? "" : r.gapToNextSeconds.toFixed(0)}
                        </td>
                        <td className="px-2 py-1" title={r.householdMatchKind}>
                          {r.sameHouseholdAsNext ? "Y" : ""}
                        </td>
                        <td className="px-2 py-1">{r.rapidNonContactFlag ? "Y" : ""}</td>
                        <td className="px-2 py-1 tabular-nums">{r.streakLength || ""}</td>
                        <td className="px-2 py-1">{r.inBurstFlag ? "Y" : ""}</td>
                        <td className="px-2 py-1">{r.rapidContactFlag ? "Y" : ""}</td>
                        <td className="px-2 py-1">{r.dateTimeRaw}</td>
                        <td className="max-w-[120px] truncate px-2 py-1" title={r.response}>
                          {r.response}
                        </td>
                        <td className="max-w-[220px] truncate px-2 py-1" title={r.question}>
                          {r.question}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === "baselines" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                Charts compare this file to saved history. A single high-rank day is context only; sustained multi-day
                patterns drive the composite score. Click a canvasser in the Summary tab to overlay their histogram.
              </div>
              <NonContactBaselineCharts
                teamHistogramPct={teamHistPct}
                canvasserHistogramPct={canvasserHistPct}
                currentHistogramPct={currentHistPct}
                trend={trend}
                topRates={topRates}
                p25Rate={baseline?.medianRapidRate ?? null}
                p75Rate={baseline?.p75RapidRate ?? null}
                banner={baselineBanner}
                historyAsOf={historyAsOf}
                historyLookbackDays={historyDays}
                selectedCanvasserName={selectedCanvasser}
                onTrendClick={(id) => void openReport(id)}
              />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function FlaggedTable({
  rows,
  title,
  showStreak = true,
  displayNames,
  onCopyList,
  onCopyTable,
}: {
  rows: EnrichedKnockRow[];
  title: string;
  showStreak?: boolean;
  displayNames: Map<string, string>;
  onCopyList: () => void;
  onCopyTable: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-50">
          {title} ({rows.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCopyList}
            className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold dark:border-white/10"
          >
            Copy as list
          </button>
          <button
            type="button"
            onClick={onCopyTable}
            className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold dark:border-white/10"
          >
            Copy table
          </button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[800px] border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-gray-900 text-left text-white">
              <th className="bg-gray-900 px-3 py-2">Canvasser</th>
              <th className="bg-gray-900 px-3 py-2">Voter</th>
              <th className="bg-gray-900 px-3 py-2">Gap (s)</th>
              {showStreak ? <th className="bg-gray-900 px-3 py-2">Streak</th> : null}
              <th className="bg-gray-900 px-3 py-2">In Burst</th>
              <th className="bg-gray-900 px-3 py-2">Datetime</th>
              <th className="bg-gray-900 px-3 py-2">Response</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.canvasserName}-${r.sourceRowNumber}-${r.occurredAt}`}
                className={`border-b border-gray-100 dark:border-white/5 ${
                  r.inBurstFlag ? "bg-amber-50 dark:bg-amber-950/20" : ""
                }`}
              >
                <td className="px-3 py-2" title={r.canvasserName}>
                  {displayNameFor(r.canvasserName, displayNames)}
                </td>
                <td className="px-3 py-2">{r.voter}</td>
                <td className="px-3 py-2 tabular-nums">
                  {r.gapToNextSeconds === null ? "" : r.gapToNextSeconds.toFixed(0)}
                </td>
                {showStreak ? <td className="px-3 py-2 tabular-nums">{r.streakLength}</td> : null}
                <td className="px-3 py-2">{r.inBurstFlag ? "Y" : ""}</td>
                <td className="px-3 py-2">{r.dateTimeRaw}</td>
                <td className="px-3 py-2">{r.response}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
