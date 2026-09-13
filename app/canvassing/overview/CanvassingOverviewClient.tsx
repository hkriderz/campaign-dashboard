"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import DateRangePicker from "@/components/common/DateRangePicker";
import OutcomeTallyStrip from "@/components/common/OutcomeTallyStrip";
import type { CanvasserOverviewRow, CanvassingOverviewStats } from "@/lib/canvassing/overview-tally";

type CandidateOption = { id: string; label: string };

type OverviewMeta = {
  updatedAt: string;
  rowCount: number;
  filteredRowCount: number;
  minDate: string;
  maxDate: string;
};

type OverviewPayload = {
  meta: OverviewMeta;
  candidates: CandidateOption[];
  stats: CanvassingOverviewStats;
  canvassers: CanvasserOverviewRow[];
};

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type SortKey =
  | "canvasserName"
  | "daysWorked"
  | "knocks"
  | "contacts"
  | "surveyed"
  | "strongSupport"
  | "support"
  | "undecided"
  | "oppose"
  | "contactRate"
  | "ssRate";

const SORT_COLUMNS: Array<{ key: SortKey; label: string; short: string }> = [
  { key: "canvasserName", label: "Canvasser", short: "Name" },
  { key: "daysWorked", label: "Days worked", short: "Days" },
  { key: "knocks", label: "Knocks", short: "Knocks" },
  { key: "contacts", label: "Contacts", short: "Contact" },
  { key: "surveyed", label: "Surveyed", short: "Srvyd" },
  { key: "strongSupport", label: "Strong Support", short: "SS" },
  { key: "support", label: "Support", short: "Sup" },
  { key: "undecided", label: "Undecided", short: "Und" },
  { key: "oppose", label: "Oppose", short: "Opp" },
  { key: "contactRate", label: "Contact %", short: "Cont%" },
  { key: "ssRate", label: "SS % of surveyed", short: "SS%" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUpdatedAt(value: string): string {
  if (!value) return "No knock index yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function cellValue(row: CanvasserOverviewRow, key: SortKey): string | number {
  if (key === "contactRate" || key === "ssRate") return formatPercent(row[key]);
  if (key === "canvasserName") return row.canvasserName;
  return row[key];
}

function sortValue(row: CanvasserOverviewRow, key: SortKey): string | number {
  return row[key];
}

export default function CanvassingOverviewClient() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tagId, setTagId] = useState("");
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [nameFilter, setNameFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("strongSupport");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (tagId) params.set("tagId", tagId);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [startDate, endDate, tagId]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/canvassing/overview${query}`);
      const body = (await res.json()) as ApiResponse<OverviewPayload>;
      if (!res.ok || !body.ok || !body.data) {
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setPayload(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    if (!files.length) {
      setError("Choose at least one Canvasser Details CSV or XLSX file.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      if (startDate) form.set("startDate", startDate);
      if (endDate) form.set("endDate", endDate);
      if (tagId) form.set("tagId", tagId);
      const res = await fetch("/api/canvassing/overview", { method: "POST", body: form });
      const body = (await res.json()) as ApiResponse<OverviewPayload>;
      if (!res.ok || !body.ok || !body.data) {
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
      setPayload(body.data);
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
  }

  function handleSort(key: SortKey) {
    if (key === sortBy) {
      setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(key);
    setSortDir(key === "canvasserName" ? "asc" : "desc");
  }

  const canvassers = payload?.canvassers ?? [];
  const showSupportColumn = Boolean(payload?.stats.support);
  const columns = useMemo(
    () => (showSupportColumn ? SORT_COLUMNS : SORT_COLUMNS.filter((col) => col.key !== "support")),
    [showSupportColumn]
  );
  const visible = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase();
    const filtered = needle
      ? canvassers.filter((row) => row.canvasserName.toLowerCase().includes(needle))
      : canvassers;
    return [...filtered].sort((a, b) => {
      const aVal = sortValue(a, sortBy);
      const bVal = sortValue(b, sortBy);
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "desc" ? bVal - aVal : aVal - bVal;
      }
      return sortDir === "desc"
        ? String(bVal).localeCompare(String(aVal))
        : String(aVal).localeCompare(String(bVal));
    });
  }, [canvassers, nameFilter, sortBy, sortDir]);

  const stats = payload?.stats;
  const headerCards: Array<{ label: string; value: number }> = stats
    ? [
        { label: "Knocks", value: stats.knocks },
        { label: "Contacts", value: stats.contacts },
        { label: "Surveyed", value: stats.surveyed },
        { label: "Strong Support", value: stats.strongSupport },
        { label: "Undecided", value: stats.undecided },
        { label: "Oppose", value: stats.oppose },
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="section-kicker text-sky-800 dark:text-sky-300">Field / Briefing</p>
          <h1 className="font-display text-3xl font-semibold text-[var(--section-ink)]">Canvassing Overview</h1>
          <hr className="section-hero__rule bg-sky-700 dark:bg-sky-300" />
          <p className="section-hero__lede">
            All saved Canvasser Details knocks. Date and candidate filters apply to the cards and table.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {formatUpdatedAt(payload?.meta.updatedAt ?? "")}
            {payload ? ` · ${formatNumber(payload.meta.rowCount)} indexed rows` : ""}
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 min-w-0 lg:max-w-3xl">
          {headerCards.map((card) => (
            <div
              key={card.label}
              className="dash-card px-3 py-2 text-xs"
            >
              <div className="text-gray-500 dark:text-gray-400">{card.label}</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                {loading && !stats ? "—" : formatNumber(card.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={onUpload}
        className="dash-card space-y-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="block text-sm min-w-0 flex-1">
            <span className="font-medium text-gray-700 dark:text-gray-200">Upload Canvasser Details</span>
            <input
              type="file"
              accept=".csv,.xlsx"
              multiple
              onChange={onFileChange}
              className="mt-1 block w-full text-sm text-[var(--section-ink)] file:mr-3 file:border-0 file:bg-[var(--section-accent)] file:px-3 file:py-1.5 file:text-[var(--section-accent-fg)]"
            />
          </label>
          <button
            type="submit"
            disabled={uploading || !files.length}
            className="dash-btn-primary px-4 py-2 text-sm disabled:opacity-50"
          >
            {uploading ? "Importing…" : "Import / append"}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Same CSV/XLSX as Knock Analysis. Re-uploads are deduped on PRIMARYID + time + question + response.
          {files.length ? ` ${files.length} file${files.length === 1 ? "" : "s"} selected.` : ""}
        </p>
      </form>

      <div className="dash-card space-y-3">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={(range) => {
            setStartDate(range.startDate);
            setEndDate(range.endDate);
          }}
          label="Knock date"
          helpText="Clear to include every saved day. Dates are America/Los_Angeles."
          minDate={payload?.meta.minDate || undefined}
          maxDate={payload?.meta.maxDate || undefined}
          allowEmpty
          tone="violet"
        />
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Candidate</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTagId("")}
              className={[
                "border px-2.5 py-1 text-xs font-medium",
                !tagId
                  ? "border-[var(--section-accent)] bg-[color-mix(in_srgb,var(--section-accent)_12%,transparent)] text-[var(--section-ink)]"
                  : "border-[var(--section-rule)] bg-transparent text-[var(--section-muted)] hover:border-[var(--section-accent)]",
              ].join(" ")}
            >
              All
            </button>
            {(payload?.candidates ?? []).map((candidate) => {
              const active = tagId === candidate.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setTagId(candidate.id)}
                  className={[
                    "border px-2.5 py-1 text-xs font-medium",
                    active
                      ? "border-[var(--section-accent)] bg-[color-mix(in_srgb,var(--section-accent)_12%,transparent)] text-[var(--section-ink)]"
                      : "border-[var(--section-rule)] bg-transparent text-[var(--section-muted)] hover:border-[var(--section-accent)]",
                  ].join(" ")}
                >
                  {candidate.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/80 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="border border-[var(--section-rule)] overflow-hidden bg-[var(--section-paper)]">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--section-rule)] flex-wrap">
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatNumber(visible.length)} canvassers
            </p>
            {stats ? (
              <OutcomeTallyStrip
                knocks={stats.knocks}
                contacts={stats.contacts}
                strongSupport={stats.strongSupport}
                undecided={stats.undecided}
                strongOppose={stats.oppose}
              />
            ) : null}
          </div>
          <input
            type="text"
            placeholder="Filter by name…"
            value={nameFilter}
            onChange={(event) => setNameFilter(event.target.value)}
            className="dash-input ml-auto px-3 py-1.5 text-xs w-44"
          />
        </div>
        {loading && !payload ? (
          <p className="px-4 py-8 text-sm text-center text-gray-500 dark:text-gray-400">Loading saved knocks…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-center text-gray-500 dark:text-gray-400">
            {payload?.meta.rowCount
              ? "No canvassers for this date or candidate filter."
              : "No knock index yet. Import the campaign Canvasser Details files to get started."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse w-full text-xs min-w-max">
              <thead className="sticky top-0 z-10 bg-gray-800 text-white">
                <tr>
                  {columns.map((col) => (
                    <th key={col.key}>
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className="w-full px-2.5 py-2 text-left font-semibold hover:bg-gray-700"
                      >
                        <span className="hidden sm:inline">{col.label}</span>
                        <span className="sm:hidden">{col.short}</span>
                        {sortBy === col.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {visible.map((row) => (
                  <tr key={row.canvasserName} className="odd:bg-white even:bg-gray-50/70 dark:odd:bg-gray-900 dark:even:bg-gray-800/40">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          "px-2.5 py-1.5 tabular-nums text-gray-800 dark:text-gray-100",
                          col.key === "canvasserName" ? "font-medium" : "",
                          col.key === "strongSupport" ? "text-emerald-700 dark:text-emerald-300" : "",
                          col.key === "oppose" ? "text-rose-700 dark:text-rose-300" : "",
                        ].join(" ")}
                      >
                        {typeof cellValue(row, col.key) === "number"
                          ? formatNumber(cellValue(row, col.key) as number)
                          : cellValue(row, col.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
