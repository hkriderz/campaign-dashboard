"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import SystemDefaultsControls, {
  fetchReportDefaults,
} from "@/components/report-defaults/SystemDefaultsControls";
import { writeTextToClipboard } from "@/lib/browser-clipboard";
import {
  callTimelineTsv,
  gapMatrixTsv,
  gapsListTsv,
  pivotTsv,
  reportCsv,
  safeDownloadFileName,
  shiftFlagCopyRows,
  shiftFlagsTsv,
  summaryBoxCsv,
} from "@/lib/phonebanking/gap-report/copy-export";
import {
  BREAK_LONG_GAP_MINUTES,
  builtInPhonebankGapShiftSettings,
  currentLaTimeHm,
  LATE_FIRST_CALL_GRACE_MINUTES,
  SCHEDULED_BREAK_MINUTES,
} from "@/lib/phonebanking/gap-report/shift";
import type {
  PhonebankCallEvent,
  PhonebankGapDetail,
  PhonebankGapReportResult,
  PhonebankGapShiftSettings,
} from "@/lib/phonebanking/gap-report/types";
import type { PhonebankGapsSystemDefaults } from "@/lib/report-defaults/types";

const LA = "America/Los_Angeles";
const SESSION_KEY = "phonebanking.gapReports.v3";
const LEGACY_SESSION_KEYS = ["phonebanking.gapReports.v1", "phonebanking.gapReports.v2"] as const;

type TagOption = { id: string; label: string };

/** Form/settings only — full report results (especially calls) exceed sessionStorage quota. */
type SessionState = {
  workDate: string;
  tagId: string;
  startTime: string;
  lunchClockOutTime: string;
  lunchReturnTime: string;
  endTime: string;
  preLunchBreakStart: string;
  postLunchBreakStart: string;
  asOfTime: string;
  excludeRaw: string;
};

function clearLegacyGapReportSessions() {
  for (const key of LEGACY_SESSION_KEYS) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function writeGapReportSession(state: SessionState) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED");
    if (!isQuota) return;
    clearLegacyGapReportSessions();
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      /* session restore is best-effort; keep the in-memory report */
    }
  }
}

type TabId = "shift" | "gaps" | "matrix" | "timeline" | "pivot";

function formatDuration(minutes: number): string {
  const mins = Math.round(minutes);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatLaTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(LA);
  return dt.isValid ? dt.toFormat("h:mm a") : "—";
}

function formatLaDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(LA);
  return dt.isValid ? dt.toFormat("MMM d, h:mm a") : "—";
}

function formatHmShort(hm: string): string {
  const dt = DateTime.fromISO(`2000-01-01T${hm}:00`, { zone: LA });
  return dt.isValid ? dt.toFormat("h:mm a") : hm;
}

function breakWindowLabel(startHm: string): string {
  const start = DateTime.fromISO(`2000-01-01T${startHm}:00`, { zone: LA });
  if (!start.isValid) return `${startHm} (+${SCHEDULED_BREAK_MINUTES}m)`;
  const end = start.plus({ minutes: SCHEDULED_BREAK_MINUTES });
  return `${start.toFormat("h:mm a")}–${end.toFormat("h:mm a")}`;
}

function todayPacific(): string {
  return DateTime.now().setZone(LA).toISODate() ?? "";
}

function parseExcluded(raw: string): Set<string> {
  const keys = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    for (const part of line.split(/[;,]/)) {
      const name = part.trim().toLowerCase();
      if (name) keys.add(name);
    }
  }
  return keys;
}

function isExcluded(name: string, excluded: Set<string>): boolean {
  return excluded.has(name.trim().toLowerCase());
}

function applyPhonebankDefaults(
  settings: PhonebankGapsSystemDefaults,
  setters: {
    setStart: (v: string) => void;
    setLunchOut: (v: string) => void;
    setLunchReturn: (v: string) => void;
    setEnd: (v: string) => void;
    setPreBreak: (v: string) => void;
    setPostBreak: (v: string) => void;
  }
) {
  setters.setStart(settings.startTime);
  setters.setLunchOut(settings.lunchClockOutTime);
  setters.setLunchReturn(settings.lunchReturnTime);
  setters.setEnd(settings.endTime);
  setters.setPreBreak(settings.preLunchBreakStart);
  setters.setPostBreak(settings.postLunchBreakStart);
}

function groupGapsChronologically(
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

function gapHighlightClass(gap: Pick<PhonebankGapDetail, "highlightLunchLong" | "highlightBreakLong">): string {
  if (gap.highlightLunchLong) {
    return "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100";
  }
  if (gap.highlightBreakLong) {
    return "bg-sky-100 text-sky-950 dark:bg-sky-950/50 dark:text-sky-100";
  }
  return "";
}

function gapKey(gap: Pick<PhonebankGapDetail, "phonebankerName" | "startAt" | "endAt">): string {
  return `${gap.phonebankerName}::${gap.startAt}::${gap.endAt}`;
}

export default function GapReportsClient({ tags }: { tags: TagOption[] }) {
  const seed = builtInPhonebankGapShiftSettings();
  const [hydrated, setHydrated] = useState(false);
  const [workDate, setWorkDate] = useState(todayPacific);
  const [tagId, setTagId] = useState("all");
  const [startTime, setStartTime] = useState(seed.startTime);
  const [lunchClockOutTime, setLunchClockOutTime] = useState(seed.lunchClockOutTime);
  const [lunchReturnTime, setLunchReturnTime] = useState(seed.lunchReturnTime);
  const [endTime, setEndTime] = useState(seed.endTime);
  const [preLunchBreakStart, setPreLunchBreakStart] = useState(seed.preLunchBreakStart);
  const [postLunchBreakStart, setPostLunchBreakStart] = useState(seed.postLunchBreakStart);
  const [asOfTime, setAsOfTime] = useState(seed.asOfTime);
  const [excludeRaw, setExcludeRaw] = useState("");
  const [result, setResult] = useState<PhonebankGapReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("shift");
  const [defaultsSource, setDefaultsSource] = useState<"system" | "built-in" | null>(null);
  const [openTimelineNames, setOpenTimelineNames] = useState<Set<string>>(() => new Set());
  const [downloading, setDownloading] = useState(false);

  const shiftSettings = useMemo<PhonebankGapShiftSettings>(
    () => ({
      startTime,
      lunchClockOutTime,
      lunchReturnTime,
      endTime,
      preLunchBreakStart,
      postLunchBreakStart,
      asOfTime,
    }),
    [
      asOfTime,
      endTime,
      lunchClockOutTime,
      lunchReturnTime,
      postLunchBreakStart,
      preLunchBreakStart,
      startTime,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      clearLegacyGapReportSessions();

      let session: SessionState | null = null;
      try {
        const raw = window.sessionStorage.getItem(SESSION_KEY);
        if (raw) session = JSON.parse(raw) as SessionState;
      } catch {
        session = null;
      }

      if (session) {
        if (!cancelled) {
          setWorkDate(session.workDate || todayPacific());
          setTagId(session.tagId || "all");
          setStartTime(session.startTime || seed.startTime);
          setLunchClockOutTime(session.lunchClockOutTime || seed.lunchClockOutTime);
          setLunchReturnTime(session.lunchReturnTime || seed.lunchReturnTime);
          setEndTime(session.endTime || seed.endTime);
          setPreLunchBreakStart(session.preLunchBreakStart || seed.preLunchBreakStart);
          setPostLunchBreakStart(session.postLunchBreakStart || seed.postLunchBreakStart);
          setAsOfTime(session.asOfTime || currentLaTimeHm());
          setExcludeRaw(session.excludeRaw || "");
          setHydrated(true);
        }
        return;
      }

      try {
        const defaults = await fetchReportDefaults("phonebank-gaps");
        if (cancelled) return;
        const settings = defaults.settings as PhonebankGapsSystemDefaults;
        applyPhonebankDefaults(settings, {
          setStart: setStartTime,
          setLunchOut: setLunchClockOutTime,
          setLunchReturn: setLunchReturnTime,
          setEnd: setEndTime,
          setPreBreak: setPreLunchBreakStart,
          setPostBreak: setPostLunchBreakStart,
        });
        setAsOfTime(currentLaTimeHm());
        setDefaultsSource(defaults.source);
      } catch {
        if (!cancelled) {
          setAsOfTime(currentLaTimeHm());
          setDefaultsSource("built-in");
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time hydrate
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeGapReportSession({
      workDate,
      tagId,
      startTime,
      lunchClockOutTime,
      lunchReturnTime,
      endTime,
      preLunchBreakStart,
      postLunchBreakStart,
      asOfTime,
      excludeRaw,
    });
  }, [
    asOfTime,
    endTime,
    excludeRaw,
    hydrated,
    lunchClockOutTime,
    lunchReturnTime,
    postLunchBreakStart,
    preLunchBreakStart,
    startTime,
    tagId,
    workDate,
  ]);

  const excluded = useMemo(() => parseExcluded(excludeRaw), [excludeRaw]);

  const filtered = useMemo(() => {
    if (!result) return null;
    if (!excluded.size) return result;
    const keep = (name: string) => !isExcluded(name, excluded);
    const phonebankerStats = result.phonebankerStats.filter((row) => keep(row.phonebankerName));
    const gapDetails = result.gapDetails.filter((row) => keep(row.phonebankerName));
    const calls = result.calls.filter((row) => keep(row.phonebankerName));
    const shiftFlags = result.shiftFlags.filter((row) => keep(row.phonebankerName));
    return {
      ...result,
      phonebankerStats,
      gapDetails,
      calls,
      shiftFlags,
      summary: {
        ...result.summary,
        phonebankerCount: phonebankerStats.length,
        callCount: calls.length,
        gapsAtOrAbove15: phonebankerStats.reduce((sum, row) => sum + row.gapsAtOrAbove15, 0),
        totalIdleMinutesAtOrAbove5: phonebankerStats.reduce(
          (sum, row) => sum + row.totalIdleMinutesAtOrAbove5,
          0
        ),
        largestGapMinutes: phonebankerStats.reduce(
          (max, row) => Math.max(max, row.largestGapMinutes),
          0
        ),
      },
    };
  }, [excluded, result]);

  const gapsByPersonStartEnd = useMemo(() => {
    const map = new Map<string, PhonebankGapDetail>();
    for (const gap of filtered?.gapDetails ?? []) {
      map.set(gapKey(gap), gap);
    }
    return map;
  }, [filtered]);

  const callsByPerson = useMemo(() => {
    const map = new Map<string, PhonebankCallEvent[]>();
    for (const call of filtered?.calls ?? []) {
      const list = map.get(call.phonebankerName) ?? [];
      list.push(call);
      map.set(call.phonebankerName, list);
    }
    return [...map.entries()]
      .map(([phonebankerName, calls]) => ({ phonebankerName, calls }))
      .sort((a, b) => a.phonebankerName.localeCompare(b.phonebankerName));
  }, [filtered]);

  const reportTitle = useMemo(
    () => `Phonebank gap report ${workDate}${tagId !== "all" ? ` · ${tagId}` : ""}`,
    [tagId, workDate]
  );

  async function copyTextToClipboard(text: string, successMessage: string) {
    setError(null);
    setMessage(null);
    try {
      await writeTextToClipboard(text);
      setMessage(successMessage);
    } catch {
      setError("Unable to copy to clipboard. Your browser may be blocking clipboard access.");
    }
  }

  async function copyReportCsv() {
    if (!filtered) {
      setError("Run a report before copying CSV.");
      return;
    }
    await copyTextToClipboard(
      reportCsv(filtered, reportTitle, shiftSettings),
      "Report CSV copied to clipboard."
    );
  }

  async function downloadReportWorkbook() {
    if (!filtered) {
      setError("Run a report before downloading.");
      return;
    }
    setError(null);
    setMessage(null);
    setDownloading(true);
    try {
      const { buildPhonebankGapWorkbook } = await import(
        "@/lib/phonebanking/gap-report/workbook-export"
      );
      const bytes = await buildPhonebankGapWorkbook({
        result: filtered,
        title: reportTitle,
        shiftSettings,
      });
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = safeDownloadFileName(reportTitle, "xlsx");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessage("Workbook downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to build the workbook.");
    } finally {
      setDownloading(false);
    }
  }

  async function runReport(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/phonebanking/gap-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workDate,
          tagId: tagId === "all" ? null : tagId,
          shiftSettings,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: { result: PhonebankGapReportResult };
      };
      if (!json.ok || !json.data) throw new Error(json.error || "Gap report failed.");
      setResult(json.data.result);
      setOpenTimelineNames(new Set());
      setActiveTab("shift");
      setMessage("Report run complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const matrixRows = useMemo(
    () => (filtered ? groupGapsChronologically(filtered.gapDetails.filter((g) => g.gapAtOrAbove5)) : []),
    [filtered]
  );
  const maxGaps = matrixRows.reduce((max, row) => Math.max(max, row.gaps.length), 0);

  const peopleWithLunchLong = useMemo(() => {
    if (!filtered) return [];
    const names = new Set(
      filtered.gapDetails.filter((g) => g.highlightLunchLong).map((g) => g.phonebankerName)
    );
    return filtered.phonebankerStats.filter((s) => names.has(s.phonebankerName));
  }, [filtered]);

  const peopleWithBreakLong = useMemo(() => {
    if (!filtered) return [];
    const names = new Set(
      filtered.gapDetails.filter((g) => g.highlightBreakLong).map((g) => g.phonebankerName)
    );
    return filtered.phonebankerStats.filter((s) => names.has(s.phonebankerName));
  }, [filtered]);

  function toggleTimeline(name: string) {
    setOpenTimelineNames((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (!hydrated) {
    return <p className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</p>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">Phonebank gap reports</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Per-person Pacific-day timelines from Scale to Win call timestamps. Gaps are next dial minus
          previous call end. Dates use America/Los_Angeles.
          {defaultsSource ? (
            <span className="ml-1 text-gray-500">
              Shift defaults source: {defaultsSource === "system" ? "system" : "built-in"}.
            </span>
          ) : null}
        </p>
      </header>

      <form
        onSubmit={(e) => void runReport(e)}
        className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Work date (Pacific)</span>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Candidate tag</span>
            <select
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
            >
              <option value="all">All campaigns</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="rounded-2xl border border-gray-200 p-4 dark:border-white/10">
          <legend className="px-1 text-sm font-semibold text-gray-900 dark:text-gray-50">
            Shift clocks (Pacific)
          </legend>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Late first call uses a {LATE_FIRST_CALL_GRACE_MINUTES}-minute grace after start. Lunch is
            highlighted only when a gap starts before lunch return and ends after it. Scheduled-break
            gaps over {BREAK_LONG_GAP_MINUTES}m are highlighted. Each break window is{" "}
            {SCHEDULED_BREAK_MINUTES} minutes.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Start</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Lunch out</span>
              <input
                type="time"
                value={lunchClockOutTime}
                onChange={(e) => setLunchClockOutTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Lunch return</span>
              <input
                type="time"
                value={lunchReturnTime}
                onChange={(e) => setLunchReturnTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">End</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                Pre-lunch break start
              </span>
              <input
                type="time"
                value={preLunchBreakStart}
                onChange={(e) => setPreLunchBreakStart(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-[11px] text-gray-500">
                {SCHEDULED_BREAK_MINUTES}m window · {breakWindowLabel(preLunchBreakStart)}
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                Post-lunch break start
              </span>
              <input
                type="time"
                value={postLunchBreakStart}
                onChange={(e) => setPostLunchBreakStart(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
              <span className="mt-1 block text-[11px] text-gray-500">
                {SCHEDULED_BREAK_MINUTES}m window · {breakWindowLabel(postLunchBreakStart)}
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">As-of</span>
              <input
                type="time"
                value={asOfTime}
                onChange={(e) => setAsOfTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
              />
            </label>
          </div>
          <SystemDefaultsControls
            className="mt-4"
            kind="phonebank-gaps"
            getSettings={() => ({
              startTime,
              lunchClockOutTime,
              lunchReturnTime,
              endTime,
              preLunchBreakStart,
              postLunchBreakStart,
            })}
            applySettings={(raw, source) => {
              const settings = raw as PhonebankGapsSystemDefaults;
              applyPhonebankDefaults(settings, {
                setStart: setStartTime,
                setLunchOut: setLunchClockOutTime,
                setLunchReturn: setLunchReturnTime,
                setEnd: setEndTime,
                setPreBreak: setPreLunchBreakStart,
                setPostBreak: setPostLunchBreakStart,
              });
              setAsOfTime(currentLaTimeHm());
              setDefaultsSource(source);
            }}
          />
        </fieldset>

        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Exclude phonebankers (optional)
          </span>
          <textarea
            value={excludeRaw}
            onChange={(e) => setExcludeRaw(e.target.value)}
            rows={2}
            placeholder="One name per line"
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
          />
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

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            {loading ? "Running…" : "Run report"}
          </button>
          <button
            type="button"
            onClick={() => void downloadReportWorkbook()}
            disabled={!filtered || downloading}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
          >
            {downloading ? "Building…" : "Download report"}
          </button>
          <button
            type="button"
            onClick={() => void copyReportCsv()}
            disabled={!filtered}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
          >
            Copy CSV
          </button>
        </div>
      </form>

      {filtered ? (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                {
                  label: "Phonebankers",
                  value: String(filtered.summary.phonebankerCount),
                  help: "People with at least one call on this Pacific day after exclusions.",
                },
                {
                  label: "Calls",
                  value: String(filtered.summary.callCount),
                  help: "Total dials included in the report.",
                },
                {
                  label: "Gaps ≥15m",
                  value: String(filtered.summary.gapsAtOrAbove15),
                  help: "Gaps of 15 minutes or more between call end and next dial.",
                },
                {
                  label: "Idle ≥5m",
                  value: formatDuration(filtered.summary.totalIdleMinutesAtOrAbove5),
                  help: "Sum of gap minutes for gaps of 5 minutes or more.",
                },
                {
                  label: "Largest gap",
                  value: formatDuration(filtered.summary.largestGapMinutes),
                  help: "Longest positive gap across all phonebankers.",
                },
              ] as const
            ).map((tile) => (
              <StatTile
                key={tile.label}
                label={tile.label}
                value={tile.value}
                help={tile.help}
                onCopy={() =>
                  void copyTextToClipboard(
                    summaryBoxCsv(tile.label, tile.value, tile.help),
                    `${tile.label} copied.`
                  )
                }
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-2 py-1 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100">
              Lunch past return ({formatHmShort(lunchReturnTime)})
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-100 px-2 py-1 text-sky-950 dark:bg-sky-950/50 dark:text-sky-100">
              Break gap &gt; {BREAK_LONG_GAP_MINUTES}m
            </span>
            <span>
              Breaks: {breakWindowLabel(preLunchBreakStart)} / {breakWindowLabel(postLunchBreakStart)} ·
              Lunch {formatHmShort(lunchClockOutTime)}–{formatHmShort(lunchReturnTime)}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2 dark:border-white/10">
            {(
              [
                ["shift", "Shift flags"],
                ["gaps", "Gaps"],
                ["matrix", "Gap matrix"],
                ["pivot", "By person"],
                ["timeline", "Call timeline"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  activeTab === id
                    ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100"
                    : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "shift" ? (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              <FlagCard
                title="Late first call"
                help={`First dial ≥ ${LATE_FIRST_CALL_GRACE_MINUTES}m after ${startTime}.`}
                rows={filtered.shiftFlags
                  .filter((r) => r.isLateFirstCall)
                  .map((r) => ({
                    name: r.phonebankerName,
                    detail: `${formatLaTime(r.firstDialAt)} · ${r.minutesLateAfterStart ?? 0}m late`,
                  }))}
                onCopy={() =>
                  void copyTextToClipboard(
                    shiftFlagsTsv(
                      "Late first call",
                      shiftFlagCopyRows(filtered.shiftFlags, "late")
                    ),
                    "Late first call copied for Sheets."
                  )
                }
              />
              <FlagCard
                title="Still on lunch"
                help={`No call ending at/after ${lunchReturnTime} while as-of is ${asOfTime} or later.`}
                rows={filtered.shiftFlags
                  .filter((r) => r.isStillOnLunch)
                  .map((r) => ({
                    name: r.phonebankerName,
                    detail: `Last end ${formatLaTime(r.lastEndedAt)}`,
                  }))}
                onCopy={() =>
                  void copyTextToClipboard(
                    shiftFlagsTsv(
                      "Still on lunch",
                      shiftFlagCopyRows(filtered.shiftFlags, "lunch")
                    ),
                    "Still on lunch copied for Sheets."
                  )
                }
              />
              <FlagCard
                title="Stopped early"
                help={`Last call end ≥ 30m before ${endTime}.`}
                rows={filtered.shiftFlags
                  .filter((r) => r.isStoppedEarly)
                  .map((r) => ({
                    name: r.phonebankerName,
                    detail: `${formatLaTime(r.lastEndedAt)} · ${r.minutesEarlyBeforeEnd ?? 0}m early`,
                  }))}
                onCopy={() =>
                  void copyTextToClipboard(
                    shiftFlagsTsv(
                      "Stopped early",
                      shiftFlagCopyRows(filtered.shiftFlags, "early")
                    ),
                    "Stopped early copied for Sheets."
                  )
                }
              />
              <FlagCard
                title="Lunch past return"
                help={`Gaps that start before ${lunchReturnTime} and resume after lunch return.`}
                tone="lunch"
                rows={peopleWithLunchLong.map((r) => {
                  const gaps = filtered.gapDetails.filter(
                    (g) => g.phonebankerName === r.phonebankerName && g.highlightLunchLong
                  );
                  const longest = gaps.reduce(
                    (max, g) => Math.max(max, g.gapMinutes),
                    0
                  );
                  return {
                    name: r.phonebankerName,
                    detail: `${gaps.length} gap${gaps.length === 1 ? "" : "s"} · longest ${formatDuration(longest)}`,
                  };
                })}
                onCopy={() =>
                  void copyTextToClipboard(
                    shiftFlagsTsv(
                      "Lunch past return",
                      peopleWithLunchLong.map((r) => {
                        const gaps = filtered.gapDetails.filter(
                          (g) =>
                            g.phonebankerName === r.phonebankerName && g.highlightLunchLong
                        );
                        const longest = gaps.reduce((max, g) => Math.max(max, g.gapMinutes), 0);
                        return {
                          name: r.phonebankerName,
                          detail: `${gaps.length} gap${gaps.length === 1 ? "" : "s"} · longest ${formatDuration(longest)}`,
                        };
                      })
                    ),
                    "Lunch past return copied for Sheets."
                  )
                }
              />
              <FlagCard
                title={`Long break gaps (>${BREAK_LONG_GAP_MINUTES}m)`}
                help="People with a gap overlapping a scheduled 10-minute break that exceeds the break highlight threshold."
                tone="break"
                rows={peopleWithBreakLong.map((r) => {
                  const gaps = filtered.gapDetails.filter(
                    (g) => g.phonebankerName === r.phonebankerName && g.highlightBreakLong
                  );
                  const longest = gaps.reduce(
                    (max, g) => Math.max(max, g.gapMinutes),
                    0
                  );
                  return {
                    name: r.phonebankerName,
                    detail: `${gaps.length} gap${gaps.length === 1 ? "" : "s"} · longest ${formatDuration(longest)}`,
                  };
                })}
                onCopy={() =>
                  void copyTextToClipboard(
                    shiftFlagsTsv(
                      `Long break gaps (>${BREAK_LONG_GAP_MINUTES}m)`,
                      peopleWithBreakLong.map((r) => {
                        const gaps = filtered.gapDetails.filter(
                          (g) =>
                            g.phonebankerName === r.phonebankerName && g.highlightBreakLong
                        );
                        const longest = gaps.reduce((max, g) => Math.max(max, g.gapMinutes), 0);
                        return {
                          name: r.phonebankerName,
                          detail: `${gaps.length} gap${gaps.length === 1 ? "" : "s"} · longest ${formatDuration(longest)}`,
                        };
                      })
                    ),
                    "Long break gaps copied for Sheets."
                  )
                }
              />
            </div>
          ) : null}

          {activeTab === "gaps" ? (
            <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Gaps</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Positive gaps only (&gt;0m). Overlaps are excluded from this list.
                  </p>
                </div>
                <CopyMiniButton
                  label="Copy Table"
                  onClick={() =>
                    void copyTextToClipboard(
                      gapsListTsv(filtered.gapDetails),
                      "Gaps copied for Sheets."
                    )
                  }
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Phonebanker</th>
                      <th className="px-3 py-2">Gap</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
                      <th className="px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.gapDetails
                      .filter((g) => g.gapMinutes > 0)
                      .map((gap) => (
                        <tr
                          key={gapKey(gap)}
                          className={`border-t border-gray-100 dark:border-white/5 ${gapHighlightClass(gap)}`}
                        >
                          <td className="px-3 py-2 font-medium">{gap.phonebankerName}</td>
                          <td className="px-3 py-2">{formatDuration(gap.gapMinutes)}</td>
                          <td className="px-3 py-2">{formatLaTime(gap.startAt)}</td>
                          <td className="px-3 py-2">{formatLaTime(gap.endAt)}</td>
                          <td className="px-3 py-2 text-xs opacity-80">
                            {[
                              gap.isOverlap ? "overlap" : null,
                              gap.highlightLunchLong
                                ? "lunch past return"
                                : gap.overlapsLunch
                                  ? "lunch window"
                                  : null,
                              gap.highlightBreakLong
                                ? `break >${BREAK_LONG_GAP_MINUTES}m`
                                : gap.overlapsPreLunchBreak
                                  ? "pre-lunch break"
                                  : gap.overlapsPostLunchBreak
                                    ? "post-lunch break"
                                    : null,
                              gap.gapAtOrAbove60 ? "≥60m" : gap.gapAtOrAbove30 ? "≥30m" : null,
                              gap.endDisposition || null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === "matrix" ? (
            <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Gap matrix</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Gaps ≥5m with start–end times. L = lunch past return · B = break &gt;
                    {BREAK_LONG_GAP_MINUTES}m · * = lunch window
                  </p>
                </div>
                <CopyMiniButton
                  label="Copy Table"
                  onClick={() =>
                    void copyTextToClipboard(
                      gapMatrixTsv(filtered.gapDetails),
                      "Gap matrix copied for Sheets."
                    )
                  }
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Phonebanker</th>
                      {Array.from({ length: maxGaps }, (_, i) => (
                        <th key={i} className="px-3 py-2">
                          Gap {i + 1}
                        </th>
                      ))}
                      <th className="px-3 py-2">Total ≥5m</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((row) => (
                      <tr
                        key={row.phonebankerName}
                        className="border-t border-gray-100 dark:border-white/5"
                      >
                        <td className="px-3 py-2 font-medium">{row.phonebankerName}</td>
                        {Array.from({ length: maxGaps }, (_, i) => {
                          const gap = row.gaps[i];
                          const marker = gap
                            ? gap.highlightLunchLong
                              ? " L"
                              : gap.highlightBreakLong
                                ? " B"
                                : gap.overlapsLunch
                                  ? " *"
                                  : ""
                            : "";
                          return (
                            <td
                              key={i}
                              className={`px-3 py-2 align-top ${gap ? gapHighlightClass(gap) : ""}`}
                            >
                              {gap ? (
                                <div className="whitespace-nowrap">
                                  <div>
                                    {formatDuration(gap.gapMinutes)}
                                    {marker}
                                  </div>
                                  <div className="text-[11px] font-normal opacity-80">
                                    {formatLaTime(gap.startAt)}–{formatLaTime(gap.endAt)}
                                  </div>
                                </div>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2">
                          {formatDuration(
                            row.gaps.reduce((sum, g) => sum + (g.gapAtOrAbove5 ? g.gapMinutes : 0), 0)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === "pivot" ? (
            <div className="rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">By person</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Per-phonebanker call and gap summary for the selected Pacific day.
                  </p>
                </div>
                <CopyMiniButton
                  label="Copy Table"
                  onClick={() =>
                    void copyTextToClipboard(
                      pivotTsv(filtered.phonebankerStats),
                      "By person table copied for Sheets."
                    )
                  }
                />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">Phonebanker</th>
                      <th className="px-3 py-2">Calls</th>
                      <th className="px-3 py-2">Connected</th>
                      <th className="px-3 py-2">First</th>
                      <th className="px-3 py-2">Last</th>
                      <th className="px-3 py-2">Span</th>
                      <th className="px-3 py-2">Talk</th>
                      <th className="px-3 py-2">C/hr</th>
                      <th className="px-3 py-2">Median gap</th>
                      <th className="px-3 py-2">≥5 / ≥15 / ≥30</th>
                      <th className="px-3 py-2">Longest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.phonebankerStats.map((row) => {
                      const longestGap = filtered.gapDetails.find(
                        (g) =>
                          g.phonebankerName === row.phonebankerName &&
                          g.startAt === row.largestGapStartAt &&
                          g.endAt === row.largestGapEndAt
                      );
                      const personHasLunch = filtered.gapDetails.some(
                        (g) => g.phonebankerName === row.phonebankerName && g.highlightLunchLong
                      );
                      const personHasBreak = filtered.gapDetails.some(
                        (g) => g.phonebankerName === row.phonebankerName && g.highlightBreakLong
                      );
                      const rowTone = personHasLunch
                        ? "bg-amber-50/80 dark:bg-amber-950/20"
                        : personHasBreak
                          ? "bg-sky-50/80 dark:bg-sky-950/20"
                          : "";
                      return (
                        <tr
                          key={row.phonebankerName}
                          className={`border-t border-gray-100 dark:border-white/5 ${rowTone}`}
                        >
                          <td className="px-3 py-2 font-medium">{row.phonebankerName}</td>
                          <td className="px-3 py-2">{row.callCount}</td>
                          <td className="px-3 py-2">{row.connectedCount}</td>
                          <td className="px-3 py-2">{formatLaTime(row.firstDialAt)}</td>
                          <td className="px-3 py-2">{formatLaTime(row.lastEndedAt)}</td>
                          <td className="px-3 py-2">{formatDuration(row.spanMinutes)}</td>
                          <td className="px-3 py-2">{formatDuration(row.talkMinutes)}</td>
                          <td className="px-3 py-2">{row.callsPerHour}</td>
                          <td className="px-3 py-2">
                            {row.medianGapMinutes == null ? "—" : formatDuration(row.medianGapMinutes)}
                          </td>
                          <td className="px-3 py-2">
                            {row.gapsAtOrAbove5} / {row.gapsAtOrAbove15} / {row.gapsAtOrAbove30}
                          </td>
                          <td
                            className={`px-3 py-2 ${
                              longestGap ? gapHighlightClass(longestGap) : ""
                            }`}
                          >
                            {formatDuration(row.largestGapMinutes)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === "timeline" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Expand a person to see their call timeline. Copy exports every phonebanker.
                </p>
                <CopyMiniButton
                  label="Copy Table"
                  onClick={() =>
                    void copyTextToClipboard(
                      callTimelineTsv(filtered.calls),
                      "Call timeline copied for Sheets."
                    )
                  }
                />
              </div>
              {callsByPerson.map(({ phonebankerName, calls }) => {
                const open = openTimelineNames.has(phonebankerName);
                return (
                  <details
                    key={phonebankerName}
                    open={open}
                    className="rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900"
                    onToggle={(event) => {
                      const nextOpen = (event.currentTarget as HTMLDetailsElement).open;
                      setOpenTimelineNames((current) => {
                        const next = new Set(current);
                        if (nextOpen) next.add(phonebankerName);
                        else next.delete(phonebankerName);
                        return next;
                      });
                    }}
                  >
                    <summary
                      className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-50"
                      onClick={(event) => {
                        event.preventDefault();
                        toggleTimeline(phonebankerName);
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="text-gray-400">
                          {open ? "▾" : "▸"}
                        </span>
                        {phonebankerName}
                        <span className="font-normal text-gray-500">
                          {calls.length} call{calls.length === 1 ? "" : "s"} ·{" "}
                          {formatLaTime(calls[0]?.dialedAt)} –{" "}
                          {formatLaTime(calls[calls.length - 1]?.endedAt)}
                        </span>
                      </span>
                    </summary>
                    {open ? (
                      <div className="overflow-x-auto border-t border-gray-100 dark:border-white/5">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                            <tr>
                              <th className="px-3 py-2">#</th>
                              <th className="px-3 py-2">Dial</th>
                              <th className="px-3 py-2">Connect</th>
                              <th className="px-3 py-2">End</th>
                              <th className="px-3 py-2">Dur</th>
                              <th className="px-3 py-2">Gap since prev end</th>
                              <th className="px-3 py-2">Disposition</th>
                              <th className="px-3 py-2">Campaign</th>
                            </tr>
                          </thead>
                          <tbody>
                            {calls.map((call, index) => {
                              const prev = index > 0 ? calls[index - 1] : null;
                              let gapLabel = "First call";
                              let highlight: PhonebankGapDetail | null = null;
                              if (prev) {
                                highlight =
                                  gapsByPersonStartEnd.get(
                                    gapKey({
                                      phonebankerName,
                                      startAt: prev.endedAt,
                                      endAt: call.dialedAt,
                                    })
                                  ) ?? null;
                                const start = DateTime.fromISO(prev.endedAt);
                                const end = DateTime.fromISO(call.dialedAt);
                                const mins = end.diff(start, "minutes").minutes;
                                if (Number.isFinite(mins)) {
                                  gapLabel =
                                    mins < 0
                                      ? `overlap ${formatDuration(Math.abs(mins))}`
                                      : formatDuration(mins);
                                }
                              }
                              return (
                                <tr
                                  key={call.callId}
                                  className={`border-t border-gray-100 dark:border-white/5 ${
                                    highlight ? gapHighlightClass(highlight) : ""
                                  }`}
                                >
                                  <td className="px-3 py-2">{index + 1}</td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {formatLaDateTime(call.dialedAt)}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {call.connectedAt ? formatLaTime(call.connectedAt) : "—"}
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {formatLaTime(call.endedAt)}
                                  </td>
                                  <td className="px-3 py-2">{Math.round(call.durationSeconds)}s</td>
                                  <td className="px-3 py-2">{gapLabel}</td>
                                  <td className="px-3 py-2">{call.disposition || "—"}</td>
                                  <td className="px-3 py-2 text-xs text-gray-500">
                                    {call.campaignName}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </details>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function CopyMiniButton({ label = "Copy", onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 transition-all hover:bg-gray-50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-white/5"
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
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </p>
        {onCopy ? <CopyMiniButton onClick={onCopy} /> : null}
      </div>
      <p className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-50">{value}</p>
      {help ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{help}</p> : null}
    </div>
  );
}

function FlagCard({
  title,
  help,
  rows,
  tone,
  onCopy,
}: {
  title: string;
  help: string;
  rows: { name: string; detail: string }[];
  tone?: "lunch" | "break";
  onCopy?: () => void;
}) {
  const shell =
    tone === "lunch"
      ? "border-amber-200 dark:border-amber-900"
      : tone === "break"
        ? "border-sky-200 dark:border-sky-900"
        : "border-gray-200 dark:border-white/10";
  return (
    <div className={`rounded-2xl border bg-white p-4 dark:bg-gray-900 ${shell}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">{title}</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{help}</p>
        </div>
        {onCopy ? <CopyMiniButton label="Copy Table" onClick={onCopy} /> : null}
      </div>
      <ul className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <li className="text-sm text-gray-500">None</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.name}
              className={`rounded-lg px-2 py-1 text-sm ${
                tone === "lunch"
                  ? "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100"
                  : tone === "break"
                    ? "bg-sky-100 text-sky-950 dark:bg-sky-950/50 dark:text-sky-100"
                    : ""
              }`}
            >
              <span className="font-medium">{row.name}</span>
              <span className="ml-2 opacity-80">{row.detail}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
