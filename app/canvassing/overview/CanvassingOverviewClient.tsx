"use client";

import { ChangeEvent, FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import DateRangePicker from "@/components/common/DateRangePicker";
import OutcomeTallyStrip from "@/components/common/OutcomeTallyStrip";
import { channelDisplayLabel, familyDisplayLabel } from "@/lib/unique-ids/classify";
import type {
  UniqueIdChangedPerson,
  UniqueIdChannel,
  UniqueIdFamily,
  UniqueIdOverviewPayload,
  UniqueIdRow,
} from "@/lib/unique-ids/types";

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

const PAGE_SIZE = 100;

const FAMILY_FILTERS: Array<{ id: UniqueIdFamily | ""; label: string }> = [
  { id: "", label: "All labels" },
  { id: "strongSupport", label: "Strong support" },
  { id: "undecided", label: "Undecided" },
  { id: "strongOppose", label: "Strong oppose" },
];

const CHANNEL_FILTERS: Array<{ id: UniqueIdChannel | ""; label: string }> = [
  { id: "", label: "All channels" },
  { id: "phone", label: "Phone" },
  { id: "text", label: "Text" },
  { id: "canvass", label: "Canvass" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatUpdatedAt(value: string, empty: string): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function familyTone(family: UniqueIdFamily): string {
  if (family === "strongSupport") return "text-emerald-700 dark:text-emerald-300";
  if (family === "strongOppose") return "text-rose-700 dark:text-rose-300";
  return "text-gray-900 dark:text-gray-100";
}

function chipClass(active: boolean): string {
  return [
    "border px-2.5 py-1 text-xs font-medium",
    active
      ? "border-[var(--section-accent)] bg-[color-mix(in_srgb,var(--section-accent)_12%,transparent)] text-[var(--section-ink)]"
      : "border-[var(--section-rule)] bg-transparent text-[var(--section-muted)] hover:border-[var(--section-accent)]",
  ].join(" ");
}

export default function CanvassingOverviewClient() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tagId, setTagId] = useState("");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [family, setFamily] = useState<UniqueIdFamily | "">("");
  const [channel, setChannel] = useState<UniqueIdChannel | "">("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<UniqueIdOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate, tagId, q, family, channel]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (tagId) params.set("tagId", tagId);
    if (q) params.set("q", q);
    if (family) params.set("family", family);
    if (channel) params.set("channel", channel);
    if (page > 1) params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return `?${params.toString()}`;
  }, [startDate, endDate, tagId, q, family, channel, page]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/canvassing/overview${query}`);
      const body = (await res.json()) as ApiResponse<UniqueIdOverviewPayload>;
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
      if (q) form.set("q", q);
      if (family) form.set("family", family);
      if (channel) form.set("channel", channel);
      form.set("page", String(page));
      form.set("pageSize", String(PAGE_SIZE));
      const res = await fetch("/api/canvassing/overview", { method: "POST", body: form });
      const body = (await res.json()) as ApiResponse<UniqueIdOverviewPayload>;
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

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/canvassing/overview/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tagId ? { tagId } : { refreshAll: true }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Refresh failed (${res.status})`);
      }
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function onExport() {
    if (!tagId) {
      setError("Select a candidate to export unique IDs.");
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/canvassing/overview${query}&format=csv`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const slug = tagId.replace(/[^a-z0-9_-]/gi, "") || "candidate";
      link.href = href;
      link.download = `unique-ids-${slug}.csv`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  const selected = Boolean(tagId);
  const combined = payload?.combined;
  const headerCards: Array<{ label: string; value: number }> = selected && combined
    ? [
        { label: "Unique IDs", value: combined.uniqueIds },
        { label: "Strong support", value: combined.strongSupport },
        { label: "Undecided", value: combined.undecided },
        { label: "Strong oppose", value: combined.strongOppose },
      ]
    : payload
      ? [{ label: "IDs across candidates", value: payload.meta.uniqueIdCount }]
      : [];

  const pageCount = payload ? Math.max(1, Math.ceil(payload.ids.total / PAGE_SIZE)) : 1;
  const warnings = [payload?.meta.phoneError, payload?.meta.textError].filter(Boolean);
  const openPerson =
    openPersonId && payload
      ? payload.changes.people.find((person) => person.personId === openPersonId) ?? null
      : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="section-kicker text-sky-800 dark:text-sky-300">Field / Briefing</p>
          <h1 className="font-display text-3xl font-semibold text-[var(--section-ink)]">Unique ID Overview</h1>
          <hr className="section-hero__rule bg-sky-700 dark:bg-sky-300" />
          <p className="section-hero__lede">
            Unique PDI / PRIMARY IDs labeled Strong support, Undecided, or Strong oppose from phone,
            text, and door knocks. Latest label wins; the same ID can still appear in more than one
            channel.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Phone {formatUpdatedAt(payload?.meta.phoneUpdatedAt ?? "", "not loaded")}
            {" · "}
            Text {formatUpdatedAt(payload?.meta.textUpdatedAt ?? "", "not loaded")}
            {" · "}
            Knocks {formatUpdatedAt(payload?.meta.knockUpdatedAt ?? "", "no knock index yet")}
            {payload ? ` · ${formatNumber(payload.meta.eventCount)} events` : ""}
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 min-w-0 lg:max-w-3xl">
          {headerCards.map((card) => (
            <div key={card.label} className="dash-card px-3 py-2 text-xs">
              <div className="text-gray-500 dark:text-gray-400">{card.label}</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                {loading && !payload ? "—" : formatNumber(card.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="dash-card space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <form onSubmit={onUpload} className="min-w-0 flex-1 space-y-2">
            <label className="block text-sm">
              <span className="font-medium text-gray-700 dark:text-gray-200">Upload Canvasser Details</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                multiple
                onChange={onFileChange}
                className="mt-1 block w-full text-sm text-[var(--section-ink)] file:mr-3 file:border-0 file:bg-[var(--section-accent)] file:px-3 file:py-1.5 file:text-[var(--section-accent-fg)]"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={uploading || !files.length}
                className="dash-btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {uploading ? "Importing…" : "Import / append knocks"}
              </button>
              <button
                type="button"
                onClick={() => void onRefresh()}
                disabled={refreshing}
                className="border border-[var(--section-rule)] px-4 py-2 text-sm text-[var(--section-ink)] hover:border-[var(--section-accent)] disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : tagId ? "Refresh phone & text" : "Refresh all phone & text"}
              </button>
            </div>
          </form>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Knock CSV/XLSX is the same as Knock Analysis. Phone and text IDs come from BigQuery
          snapshots (QC lists excluded).
          {files.length ? ` ${files.length} file${files.length === 1 ? "" : "s"} selected.` : ""}
        </p>
      </div>

      <div className="dash-card space-y-3">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={(range) => {
            setStartDate(range.startDate);
            setEndDate(range.endDate);
          }}
          label="Contact date"
          helpText="Clear to include every saved day. Dates are America/Los_Angeles."
          minDate={payload?.meta.minDate || undefined}
          maxDate={payload?.meta.maxDate || undefined}
          allowEmpty
          tone="violet"
        />
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Candidate</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setTagId("")} className={chipClass(!tagId)}>
              All
            </button>
            {(payload?.candidates ?? []).map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setTagId(candidate.id)}
                className={chipClass(tagId === candidate.id)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/80 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}
      {warnings.map((warning) => (
        <div
          key={warning}
          className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
        >
          {warning}
        </div>
      ))}

      {selected && combined ? (
        <div className="dash-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--section-ink)]">Latest unique IDs</h2>
            <OutcomeTallyStrip
              strongSupport={combined.strongSupport}
              undecided={combined.undecided}
              strongOppose={combined.strongOppose}
            />
          </div>
          <ChannelTable payload={payload} loading={loading} />
          <ChangeTable payload={payload} onOpenPerson={setOpenPersonId} />
        </div>
      ) : null}

      {!selected && payload ? (
        <div className="border border-[var(--section-rule)] overflow-hidden bg-[var(--section-paper)]">
          <div className="px-4 py-2.5 border-b border-[var(--section-rule)]">
            <p className="text-sm font-semibold text-[var(--section-ink)]">By candidate</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              IDs are not merged across races. Select a candidate for the ID list.
            </p>
          </div>
          {loading && !payload.candidateSummaries.length ? (
            <p className="px-4 py-8 text-sm text-center text-gray-500 dark:text-gray-400">Loading unique IDs…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-collapse w-full text-xs min-w-max">
                <thead className="sticky top-0 z-10 bg-gray-800 text-white">
                  <tr>
                    <th className="px-2.5 py-2 text-left">Candidate</th>
                    <th className="px-2.5 py-2 text-left">Unique IDs</th>
                    <th className="px-2.5 py-2 text-left">Strong support</th>
                    <th className="px-2.5 py-2 text-left">Undecided</th>
                    <th className="px-2.5 py-2 text-left">Strong oppose</th>
                    <th className="px-2.5 py-2 text-left">Phone</th>
                    <th className="px-2.5 py-2 text-left">Text</th>
                    <th className="px-2.5 py-2 text-left">Canvass</th>
                    <th className="px-2.5 py-2 text-left">Changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {payload.candidateSummaries.map((row) => (
                    <tr key={row.id} className="odd:bg-white even:bg-gray-50/70 dark:odd:bg-gray-900 dark:even:bg-gray-800/40">
                      <td className="px-2.5 py-1.5 font-medium">
                        <button type="button" onClick={() => setTagId(row.id)} className="underline-offset-2 hover:underline">
                          {row.label}
                        </button>
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums">{formatNumber(row.combined.uniqueIds)}</td>
                      <td className={`px-2.5 py-1.5 tabular-nums ${familyTone("strongSupport")}`}>
                        {formatNumber(row.combined.strongSupport)}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums">{formatNumber(row.combined.undecided)}</td>
                      <td className={`px-2.5 py-1.5 tabular-nums ${familyTone("strongOppose")}`}>
                        {formatNumber(row.combined.strongOppose)}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums">{formatNumber(row.byChannel.phone.uniqueIds)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{formatNumber(row.byChannel.text.uniqueIds)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{formatNumber(row.byChannel.canvass.uniqueIds)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">
                        {row.changes.changed ? (
                          <button
                            type="button"
                            onClick={() => setTagId(row.id)}
                            className="underline-offset-2 hover:underline"
                          >
                            {formatNumber(row.changes.changed)}
                          </button>
                        ) : (
                          formatNumber(row.changes.changed)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {selected ? (
        <div className="border border-[var(--section-rule)] overflow-hidden bg-[var(--section-paper)]">
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--section-rule)] flex-wrap">
            <div className="min-w-0 space-y-1">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {formatNumber(payload?.ids.total ?? 0)} unique IDs
              </p>
            </div>
            <form
              className="ml-auto flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setQ(qDraft.trim());
              }}
            >
              <input
                type="text"
                placeholder="Search PDI / PRIMARYID…"
                value={qDraft}
                onChange={(event) => setQDraft(event.target.value)}
                className="dash-input px-3 py-1.5 text-xs w-52"
              />
              <select
                value={family}
                onChange={(event) => setFamily(event.target.value as UniqueIdFamily | "")}
                className="dash-input px-2 py-1.5 text-xs"
              >
                {FAMILY_FILTERS.map((item) => (
                  <option key={item.id || "all"} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value as UniqueIdChannel | "")}
                className="dash-input px-2 py-1.5 text-xs"
              >
                {CHANNEL_FILTERS.map((item) => (
                  <option key={item.id || "all"} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="border border-[var(--section-rule)] px-3 py-1.5 text-xs">
                Search
              </button>
              <button
                type="button"
                onClick={() => void onExport()}
                disabled={exporting || !payload?.ids.total}
                className="dash-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {exporting ? "Exporting…" : "Download CSV"}
              </button>
            </form>
          </div>
          {loading && !payload ? (
            <p className="px-4 py-8 text-sm text-center text-gray-500 dark:text-gray-400">Loading unique IDs…</p>
          ) : !payload?.ids.rows.length ? (
            <p className="px-4 py-8 text-sm text-center text-gray-500 dark:text-gray-400">
              {payload?.meta.eventCount
                ? "No unique IDs for this date, label, or channel filter."
                : "No labeled IDs yet. Refresh phone & text or import Canvasser Details."}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="border-collapse w-full text-xs min-w-max">
                  <thead className="sticky top-0 z-10 bg-gray-800 text-white">
                    <tr>
                      <th className="px-2.5 py-2 text-left">PDI / PRIMARYID</th>
                      <th className="px-2.5 py-2 text-left">Latest label</th>
                      <th className="px-2.5 py-2 text-left">Latest date</th>
                      <th className="px-2.5 py-2 text-left">Channel</th>
                      <th className="px-2.5 py-2 text-left">Channels seen</th>
                      <th className="px-2.5 py-2 text-left">List / assignment</th>
                      <th className="px-2.5 py-2 text-left">Prior label</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {payload.ids.rows.map((row) => (
                      <IdRow
                        key={row.personId}
                        row={row}
                        onOpenPerson={row.changed ? setOpenPersonId : undefined}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-[var(--section-rule)] text-xs">
                <p className="text-gray-500 dark:text-gray-400">
                  Page {payload.ids.page} of {pageCount}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    className="border border-[var(--section-rule)] px-3 py-1 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= pageCount}
                    onClick={() => setPage((value) => value + 1)}
                    className="border border-[var(--section-rule)] px-3 py-1 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {openPerson ? (
        <ChangedPersonModal person={openPerson} onClose={() => setOpenPersonId(null)} />
      ) : null}
    </div>
  );
}

function ChannelTable({
  payload,
  loading,
}: {
  payload: UniqueIdOverviewPayload | null;
  loading: boolean;
}) {
  if (!payload) return null;
  const rows: Array<{ key: UniqueIdChannel; label: string }> = [
    { key: "phone", label: "Phone" },
    { key: "text", label: "Text" },
    { key: "canvass", label: "Canvass" },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 dark:text-gray-400">
            <th className="py-1 pr-3 font-medium">Channel</th>
            <th className="py-1 pr-3 font-medium">Unique IDs</th>
            <th className="py-1 pr-3 font-medium">Strong support</th>
            <th className="py-1 pr-3 font-medium">Undecided</th>
            <th className="py-1 font-medium">Strong oppose</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const counts = payload.byChannel[row.key];
            return (
              <tr key={row.key} className="border-t border-[var(--section-rule)]">
                <td className="py-1.5 pr-3 font-medium">{row.label}</td>
                <td className="py-1.5 pr-3 tabular-nums">{loading ? "—" : formatNumber(counts.uniqueIds)}</td>
                <td className={`py-1.5 pr-3 tabular-nums ${familyTone("strongSupport")}`}>
                  {loading ? "—" : formatNumber(counts.strongSupport)}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">{loading ? "—" : formatNumber(counts.undecided)}</td>
                <td className={`py-1.5 tabular-nums ${familyTone("strongOppose")}`}>
                  {loading ? "—" : formatNumber(counts.strongOppose)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChangeTable({
  payload,
  onOpenPerson,
}: {
  payload: UniqueIdOverviewPayload | null;
  onOpenPerson: (personId: string) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (!payload) return null;
  const { held, changed, transitions, people } = payload.changes;
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {formatNumber(held)} held the same family in this date range · {formatNumber(changed)} changed
      </p>
      {transitions.length ? (
        <div className="overflow-x-auto">
          <table className="border-collapse w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400">
                <th className="py-1 pr-3 font-medium">From</th>
                <th className="py-1 pr-3 font-medium">To</th>
                <th className="py-1 font-medium">Unique IDs</th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((row) => {
                const key = `${row.from}|${row.to}`;
                const expanded = openKey === key;
                const ids = people
                  .filter((person) => person.from === row.from && person.to === row.to)
                  .map((person) => person.personId);
                return (
                  <Fragment key={key}>
                    <tr className="border-t border-[var(--section-rule)]">
                      <td className={`py-1.5 pr-3 ${familyTone(row.from)}`}>{familyDisplayLabel(row.from)}</td>
                      <td className={`py-1.5 pr-3 ${familyTone(row.to)}`}>{familyDisplayLabel(row.to)}</td>
                      <td className="py-1.5 tabular-nums">
                        <button
                          type="button"
                          onClick={() => setOpenKey(expanded ? null : key)}
                          className="underline-offset-2 hover:underline"
                        >
                          {formatNumber(row.count)}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-t border-[var(--section-rule)] bg-[color-mix(in_srgb,var(--section-accent)_6%,transparent)]">
                        <td colSpan={3} className="py-2 pr-3">
                          <ul className="flex flex-wrap gap-1.5">
                            {ids.map((personId) => (
                              <li key={personId}>
                                <button
                                  type="button"
                                  onClick={() => onOpenPerson(personId)}
                                  className="border border-[var(--section-rule)] px-2 py-0.5 font-mono text-[11px] hover:border-[var(--section-accent)]"
                                >
                                  {personId}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">No family changes in this date range.</p>
      )}
    </div>
  );
}

function IdRow({
  row,
  onOpenPerson,
}: {
  row: UniqueIdRow;
  onOpenPerson?: (personId: string) => void;
}) {
  return (
    <tr className="odd:bg-white even:bg-gray-50/70 dark:odd:bg-gray-900 dark:even:bg-gray-800/40">
      <td className="px-2.5 py-1.5 font-medium font-mono">
        {onOpenPerson ? (
          <button type="button" onClick={() => onOpenPerson(row.personId)} className="underline-offset-2 hover:underline">
            {row.personId}
          </button>
        ) : (
          row.personId
        )}
      </td>
      <td className={`px-2.5 py-1.5 ${familyTone(row.family)}`}>{familyDisplayLabel(row.family)}</td>
      <td className="px-2.5 py-1.5 tabular-nums">{row.occurredOn}</td>
      <td className="px-2.5 py-1.5">{channelDisplayLabel(row.channel)}</td>
      <td className="px-2.5 py-1.5">{row.channels.map(channelDisplayLabel).join(", ")}</td>
      <td className="px-2.5 py-1.5">{row.campaignName}</td>
      <td className={`px-2.5 py-1.5 ${row.priorFamily ? familyTone(row.priorFamily) : "text-gray-400"}`}>
        {row.priorFamily ? familyDisplayLabel(row.priorFamily) : "—"}
      </td>
    </tr>
  );
}

function ChangedPersonModal({
  person,
  onClose,
}: {
  person: UniqueIdChangedPerson;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unique-id-change-title"
        className="dash-card max-h-[85vh] w-full max-w-2xl overflow-hidden bg-[var(--section-paper)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--section-rule)] px-4 py-3">
          <div>
            <h2 id="unique-id-change-title" className="font-mono text-sm font-semibold text-[var(--section-ink)]">
              {person.personId}
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              <span className={familyTone(person.from)}>{familyDisplayLabel(person.from)}</span>
              {" → "}
              <span className={familyTone(person.to)}>{familyDisplayLabel(person.to)}</span>
              {` · ${person.events.length} labeled contact${person.events.length === 1 ? "" : "s"} in this date range`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--section-rule)] px-2.5 py-1 text-xs"
          >
            Close
          </button>
        </div>
        <div className="max-h-[65vh] overflow-auto">
          <table className="border-collapse w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 text-white">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Channel</th>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-left">List / assignment</th>
                <th className="px-3 py-2 text-left">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {person.events.map((event, index) => (
                <tr key={`${event.occurredAt}-${event.channel}-${index}`}>
                  <td className="px-3 py-1.5 tabular-nums">
                    {event.occurredOn}
                    {event.occurredAt.includes("T") ? ` ${event.occurredAt.slice(11, 16)}` : ""}
                  </td>
                  <td className="px-3 py-1.5">{channelDisplayLabel(event.channel)}</td>
                  <td className={`px-3 py-1.5 ${familyTone(event.family)}`}>{familyDisplayLabel(event.family)}</td>
                  <td className="px-3 py-1.5">{event.campaignName}</td>
                  <td className="px-3 py-1.5">{event.actorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
