"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import OverviewDetailColumnControls, {
  ColumnChecklist,
} from "@/components/canvassing/OverviewDetailColumnControls";
import {
  buildLitQcCsv,
  buildLitQcDetailTsv,
  defaultVisibleLitQcDetailColumnIds,
  filterLitQcCanvasserRows,
  flattenLitQcDetails,
  LIT_QC_DETAIL_COLUMNS,
  litQcCanvasserOptions,
  litQcDetailCellValue,
  litQcDetailHeaders,
  loadLitQcDetailColumnIds,
  saveLitQcDetailColumnIds,
  summarizeLitQc,
  toggleLitQcDetailColumn,
  type LitQcCanvasserRow,
  type LitQcDetailColumnId,
  type LitQcDetailRow,
  type LitQcTally,
} from "@/lib/canvassing/lit-qc";
import CheckboxFilterMenu, { useActorGroups } from "@/components/qc-recontact/CheckboxFilterMenu";
import DateRangePicker from "@/components/common/DateRangePicker";
import { downloadCsvFile } from "@/lib/pivot-csv-export";
import {
  buildCanvasserOverviewCsv,
  canvasserOverviewExportFilename,
  canvasserProjectOptions,
  canvasserQcPhonebankOptions,
  filterCanvasserOverviewByProjects,
  filterCanvasserOverviewByQcPhonebanks,
  formatOverviewPercent,
  overviewPercentBandClass,
  summarizeCanvasserOverview,
  type CanvasserFamilyBlock,
  type CanvasserOverviewDetail,
  type CanvasserOverviewPayload,
  type CanvasserOverviewRow,
} from "@/lib/qc-recontact/canvasser-overview";
import { recontactNamesMatch } from "@/lib/qc-recontact/names";
import {
  filterNamedRows,
  type PeopleFilterMode,
} from "@/lib/qc-recontact/project-people-filter";
import {
  buildOverviewDetailTsv,
  CANVASSER_OVERVIEW_DETAIL_COLS_STORAGE_KEY,
  defaultVisibleOverviewDetailColumnIds,
  filterOverviewRowsByHasNotes,
  loadOverviewDetailColumnIds,
  overviewDetailHeadersForColumns,
  overviewDetailCellValue,
  saveOverviewDetailColumnIds,
  toggleOverviewDetailColumn,
  type OverviewDetailColumnId,
} from "@/lib/qc-recontact/overview-detail-columns";
import { formatShortUsDate } from "@/lib/slice-key";
import type { UniqueIdFamily } from "@/lib/unique-ids/types";

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function chipClass(active: boolean): string {
  return [
    "border px-2.5 py-1 text-xs font-medium disabled:opacity-50",
    active
      ? "border-[var(--section-accent)] bg-[color-mix(in_srgb,var(--section-accent)_12%,transparent)] text-[var(--section-ink)]"
      : "border-[var(--section-rule)] bg-transparent text-[var(--section-muted)] hover:border-[var(--section-accent)]",
  ].join(" ");
}

function familyTone(family: UniqueIdFamily | null): string {
  if (family === "strongSupport") return "text-emerald-700 dark:text-emerald-300";
  if (family === "strongOppose") return "text-rose-700 dark:text-rose-300";
  return "";
}

function FamilyCells({ block }: { block: CanvasserFamilyBlock }) {
  return (
    <>
      <td className="px-2.5 py-1.5 text-right tabular-nums border-l border-[var(--section-rule)]">
        {formatNumber(block.surveyed)}
      </td>
      <td className={`px-2.5 py-1.5 text-right tabular-nums ${familyTone("strongSupport")}`}>
        {formatNumber(block.strongSupport)}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(block.undecided)}</td>
      <td className={`px-2.5 py-1.5 text-right tabular-nums ${familyTone("strongOppose")}`}>
        {formatNumber(block.strongOppose)}
      </td>
    </>
  );
}

function DetailTable({
  details,
  columnIds,
}: {
  details: CanvasserOverviewDetail[];
  columnIds: readonly OverviewDetailColumnId[];
}) {
  const headers = overviewDetailHeadersForColumns(columnIds, "canvasser");
  return (
    <table className="border-collapse w-full text-xs min-w-max">
      <thead>
        <tr className="text-left text-gray-500 dark:text-gray-400">
          {headers.map((header) => (
            <th key={header} className="px-2.5 py-1.5 font-medium">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
        {details.map((detail) => (
          <tr key={`${detail.pdiId}-${detail.callDate}-${detail.callTime}`}>
            {columnIds.map((id) => {
              let text = overviewDetailCellValue(detail, id);
              if (id === "originalFlagDate" || id === "callDate") text = formatShortUsDate(text) || text;
              if (
                (id === "contactedAnswer" ||
                  id === "notesAnswer" ||
                  id === "pollingLabel" ||
                  id === "finalResultLabel" ||
                  id === "callTime") &&
                !text
              ) {
                text = "—";
              }
              const tone =
                id === "originalFlag"
                  ? familyTone(detail.originalFlagFamily)
                  : id === "pollingLabel"
                    ? familyTone(detail.pollingFamily)
                    : id === "finalResultLabel"
                      ? familyTone(detail.finalResultFamily)
                      : "";
              const mono = id === "pdiId" ? "font-mono" : "";
              const nums =
                id === "originalFlagDate" || id === "callDate" || id === "callTime" ? "tabular-nums" : "";
              const title = id === "notesAnswer" && detail.notesAnswer ? detail.notesAnswer : undefined;
              const display =
                id === "notesAnswer" && text.length > 48 ? `${text.slice(0, 48)}…` : text;
              return (
                <td key={id} className={`px-2.5 py-1.5 ${tone} ${mono} ${nums}`} title={title}>
                  {display}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function CanvasserOverviewClient() {
  const [tagId, setTagId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [payload, setPayload] = useState<CanvasserOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);
  const [detailColumns, setDetailColumns] = useState<OverviewDetailColumnId[]>(
    defaultVisibleOverviewDetailColumnIds
  );
  const [hasNotesOnly, setHasNotesOnly] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [qcPhonebanks, setQcPhonebanks] = useState<string[]>([]);
  const [canvassersSelected, setCanvassersSelected] = useState<string[]>([]);
  const [canvasserMode, setCanvasserMode] = useState<PeopleFilterMode>("include");
  const canvasserGroups = useActorGroups("canvasser");
  const [copyLabel, setCopyLabel] = useState("Copy table");
  const [mode, setMode] = useState<"recall" | "lit">("recall");
  const [litStartDate, setLitStartDate] = useState("");
  const [litEndDate, setLitEndDate] = useState("");
  const [litPayload, setLitPayload] = useState<LitQcTally | null>(null);
  const [litLoading, setLitLoading] = useState(false);
  const [litError, setLitError] = useState<string | null>(null);
  const [litProjects, setLitProjects] = useState<string[]>([]);
  const [litCanvassersSelected, setLitCanvassersSelected] = useState<string[]>([]);
  const [litCanvasserMode, setLitCanvasserMode] = useState<PeopleFilterMode>("include");
  const [litQcCanvassersSelected, setLitQcCanvassersSelected] = useState<string[]>([]);
  const [litQcCanvasserMode, setLitQcCanvasserMode] = useState<PeopleFilterMode>("include");
  const [litPdiSearch, setLitPdiSearch] = useState("");
  const [litCopyLabel, setLitCopyLabel] = useState("Copy table");
  const [litDetailColumns, setLitDetailColumns] = useState<LitQcDetailColumnId[]>(
    defaultVisibleLitQcDetailColumnIds
  );
  const [litFlagsImporting, setLitFlagsImporting] = useState(false);
  const [litFlagsMessage, setLitFlagsMessage] = useState<string | null>(null);
  const litFlagsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDetailColumns(loadOverviewDetailColumnIds(CANVASSER_OVERVIEW_DETAIL_COLS_STORAGE_KEY));
    setLitDetailColumns(loadLitQcDetailColumnIds());
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (tagId) params.set("tagId", tagId);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [tagId, startDate, endDate]);

  const loadOverview = useCallback((signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    return (async () => {
      try {
        const res = await fetch(`/api/canvassing/canvassers${query}`, { signal });
        const body = (await res.json()) as ApiResponse<CanvasserOverviewPayload>;
        if (signal.aborted) return;
        if (!res.ok || !body.ok || !body.data) {
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        setPayload(body.data);
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
  }, [query]);

  const litQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (litStartDate) params.set("startDate", litStartDate);
    if (litEndDate) params.set("endDate", litEndDate);
    for (const project of litProjects) params.append("project", project);
    const text = params.toString();
    return text ? `?${text}` : "";
  }, [litStartDate, litEndDate, litProjects]);

  const loadLit = useCallback((signal: AbortSignal) => {
    setLitLoading(true);
    setLitError(null);
    return (async () => {
      try {
        const res = await fetch(`/api/canvassing/canvassers/lit${litQuery}`, { signal });
        const body = (await res.json()) as ApiResponse<LitQcTally>;
        if (signal.aborted) return;
        if (!res.ok || !body.ok || !body.data) {
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        setLitPayload(body.data);
      } catch (err) {
        if (signal.aborted) return;
        setLitError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!signal.aborted) setLitLoading(false);
      }
    })();
  }, [litQuery]);

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview]);

  useEffect(() => {
    if (mode !== "lit") return;
    const controller = new AbortController();
    void loadLit(controller.signal);
    return () => controller.abort();
  }, [mode, loadLit]);

  const dateRows = payload?.canvassers ?? [];
  const projectOptions = useMemo(() => canvasserProjectOptions(dateRows), [dateRows]);
  const qcPhonebankOptions = useMemo(() => canvasserQcPhonebankOptions(dateRows), [dateRows]);
  const canvasserOptions = useMemo(() => dateRows.map((row) => row.canvasserName), [dateRows]);
  const projectRows = useMemo(
    () => filterCanvasserOverviewByProjects(dateRows, projects),
    [dateRows, projects]
  );
  const qcRows = useMemo(
    () => filterCanvasserOverviewByQcPhonebanks(projectRows, qcPhonebanks),
    [projectRows, qcPhonebanks]
  );
  const peopleRows = useMemo(
    () => filterNamedRows(qcRows, canvassersSelected, canvasserMode, (row) => row.canvasserName, recontactNamesMatch),
    [qcRows, canvassersSelected, canvasserMode]
  );
  const visibleCanvassers = useMemo(
    () => filterOverviewRowsByHasNotes(peopleRows, hasNotesOnly),
    [peopleRows, hasNotesOnly]
  );
  const surveyedTotal = useMemo(
    () => visibleCanvassers.reduce((sum, row) => sum + row.surveyed, 0),
    [visibleCanvassers]
  );
  const totals = useMemo(() => summarizeCanvasserOverview(visibleCanvassers), [visibleCanvassers]);
  const litRows = litPayload?.canvassers ?? [];
  const litCanvasserOptions = useMemo(() => litRows.map((row) => row.canvasserName), [litRows]);
  const litQcCanvasserFilterOptions = useMemo(() => litQcCanvasserOptions(litRows), [litRows]);
  const visibleLitCanvassers = useMemo(() => {
    const byOriginal = filterNamedRows(
      litRows,
      litCanvassersSelected,
      litCanvasserMode,
      (row) => row.canvasserName,
      recontactNamesMatch
    );
    return filterLitQcCanvasserRows(byOriginal, {
      qcCanvassers: litQcCanvassersSelected,
      qcCanvasserMode: litQcCanvasserMode,
      pdiQuery: litPdiSearch,
      namesMatch: recontactNamesMatch,
    });
  }, [
    litRows,
    litCanvassersSelected,
    litCanvasserMode,
    litQcCanvassersSelected,
    litQcCanvasserMode,
    litPdiSearch,
  ]);
  const litTotals = useMemo(() => summarizeLitQc(visibleLitCanvassers), [visibleLitCanvassers]);
  const litVoterTotal = useMemo(
    () => visibleLitCanvassers.reduce((sum, row) => sum + row.votersChecked, 0),
    [visibleLitCanvassers]
  );

  function selectCandidate(id: string) {
    setTagId(id);
    setStartDate("");
    setEndDate("");
    setOpenName(null);
  }

  function setColumns(next: OverviewDetailColumnId[]) {
    setDetailColumns(next);
    saveOverviewDetailColumnIds(CANVASSER_OVERVIEW_DETAIL_COLS_STORAGE_KEY, next);
  }

  function downloadCsv() {
    if (!visibleCanvassers.length || !payload) return;
    const csv = buildCanvasserOverviewCsv({ canvassers: visibleCanvassers }, detailColumns);
    downloadCsvFile(csv, canvasserOverviewExportFilename(payload.tagId, startDate, endDate));
  }

  async function copyTable() {
    if (!visibleCanvassers.length) return;
    const details = visibleCanvassers.flatMap((row) => row.details);
    const tsv = buildOverviewDetailTsv(details, detailColumns, "canvasser");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy table"), 1600);
    } catch {
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy table"), 1600);
    }
  }

  function setLitColumns(next: LitQcDetailColumnId[]) {
    setLitDetailColumns(next);
    saveLitQcDetailColumnIds(next);
  }

  function downloadLitCsv() {
    if (!visibleLitCanvassers.length) return;
    const csv = buildLitQcCsv(visibleLitCanvassers, litDetailColumns);
    const range = [litStartDate, litEndDate].filter(Boolean).join("_") || "all";
    downloadCsvFile(csv, `lit-qc-${range}.csv`);
  }

  async function copyLitTable() {
    if (!visibleLitCanvassers.length) return;
    try {
      await navigator.clipboard.writeText(buildLitQcDetailTsv(visibleLitCanvassers, litDetailColumns));
      setLitCopyLabel("Copied");
      window.setTimeout(() => setLitCopyLabel("Copy table"), 1600);
    } catch {
      setLitCopyLabel("Copy failed");
      window.setTimeout(() => setLitCopyLabel("Copy table"), 1600);
    }
  }

  async function importLitFlags(fileList: FileList | null) {
    if (!fileList?.length) return;
    setLitFlagsImporting(true);
    setLitFlagsMessage(null);
    setLitError(null);
    try {
      const form = new FormData();
      for (const file of Array.from(fileList)) {
        form.append("files", file, file.name);
      }
      const res = await fetch("/api/canvassing/canvassers/lit/flags", { method: "POST", body: form });
      const body = (await res.json()) as ApiResponse<{
        importMeta: { rowsAdded: number; rowsSkippedDup: number; fileNames: string[] };
        litRows: number;
        flyerRows: number;
        skippedOther: number;
        skippedNoPrimaryId: number;
        skippedUnclassified: number;
      }>;
      if (!res.ok || !body.ok || !body.data) {
        throw new Error(body.error || `Import failed (${res.status})`);
      }
      const {
        importMeta,
        litRows: parsedLit,
        flyerRows: parsedFlyer,
        skippedOther,
        skippedNoPrimaryId,
        skippedUnclassified,
      } = body.data;
      const parts = [
        `Imported ${formatNumber(importMeta.rowsAdded)} new flag row${importMeta.rowsAdded === 1 ? "" : "s"}`,
        `(${formatNumber(parsedLit)} lit · ${formatNumber(parsedFlyer)} flyer)`,
        `from ${importMeta.fileNames.join(", ") || "upload"}`,
      ];
      if (importMeta.rowsSkippedDup) parts.push(`(${formatNumber(importMeta.rowsSkippedDup)} already in index)`);
      if (skippedOther || skippedNoPrimaryId || skippedUnclassified) {
        parts.push(
          `· skipped ${formatNumber(skippedOther + skippedNoPrimaryId + skippedUnclassified)} other/invalid rows`
        );
      }
      setLitFlagsMessage(parts.join(" "));
      await loadLit(new AbortController().signal);
    } catch (err) {
      setLitError(err instanceof Error ? err.message : String(err));
    } finally {
      setLitFlagsImporting(false);
      if (litFlagsInputRef.current) litFlagsInputRef.current.value = "";
    }
  }

  const selected = Boolean(tagId);
  const showing = Boolean(payload && payload.tagId === tagId);

  return (
    <div className="space-y-5">
      <div>
        <p className="section-kicker text-teal-800 dark:text-teal-300">Field / QC</p>
        <h1 className="font-display text-3xl font-semibold text-[var(--section-ink)]">Canvasser QC Overview</h1>
        <hr className="section-hero__rule bg-teal-700 dark:bg-teal-300" />
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            className={chipClass(mode === "recall")}
            aria-pressed={mode === "recall"}
            onClick={() => {
              setMode("recall");
              setOpenName(null);
            }}
          >
            Recall
          </button>
          <button
            type="button"
            className={chipClass(mode === "lit")}
            aria-pressed={mode === "lit"}
            onClick={() => {
              setMode("lit");
              setOpenName(null);
            }}
          >
            Lit QC
          </button>
        </div>
        <p className="section-hero__lede">
          {mode === "lit"
            ? "Later door checks of lit left at not-homes, grouped by the canvasser who left it. Import PDI lit observation flag exports for per-PDI answers. Saw lit % counts USA flag as an answer. Each canvasser expands to households, with the voters at that door listed underneath."
            : "QC calls that reached the voter, grouped by the canvasser who originally ID’d them. Recall contact is Yes ÷ (Yes+Unsure+No) on “Were you contacted?” — calls with no answer (e.g. GOTV scripts) do not dilute the rate. Strong support rates use only the voters that canvasser originally marked strong support."}
        </p>
      </div>

      <div className="dash-card space-y-3">
        <DateRangePicker
          startDate={mode === "lit" ? litStartDate : startDate}
          endDate={mode === "lit" ? litEndDate : endDate}
          onChange={(range) => {
            if (mode === "lit") {
              setLitStartDate(range.startDate);
              setLitEndDate(range.endDate);
            } else {
              setStartDate(range.startDate);
              setEndDate(range.endDate);
            }
            setOpenName(null);
          }}
          label={mode === "lit" ? "QC project date" : "QC call date"}
          helpText={
            mode === "lit"
              ? "Clear to include every lit QC day in the knock index. Dates are the day of the lit QC walk — picking a day shows original canvassers whose prior lit drops were checked that day."
              : "Clear to include every saved QC day. Dates are the QC call date."
          }
          minDate={(mode === "lit" ? litPayload?.minDate : payload?.minDate) || undefined}
          maxDate={(mode === "lit" ? litPayload?.maxDate : payload?.maxDate) || undefined}
          allowEmpty
          tone="emerald"
        />
        <div className="flex flex-wrap items-center gap-2">
          {mode === "lit" ? (
            <>
              <CheckboxFilterMenu
                label="Canvass projects"
                options={litPayload?.projects ?? []}
                selected={litProjects}
                onSelectedChange={setLitProjects}
              />
              <CheckboxFilterMenu
                label="Original canvassers"
                options={litCanvasserOptions}
                selected={litCanvassersSelected}
                onSelectedChange={setLitCanvassersSelected}
                mode={litCanvasserMode}
                onModeChange={setLitCanvasserMode}
                groups={canvasserGroups.groups}
                onGroupsChange={canvasserGroups.setGroups}
              />
              <CheckboxFilterMenu
                label="QC canvassers"
                options={litQcCanvasserFilterOptions}
                selected={litQcCanvassersSelected}
                onSelectedChange={setLitQcCanvassersSelected}
                mode={litQcCanvasserMode}
                onModeChange={setLitQcCanvasserMode}
                groups={canvasserGroups.groups}
                onGroupsChange={canvasserGroups.setGroups}
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--section-muted)]">
                <span className="whitespace-nowrap">PDI</span>
                <input
                  type="search"
                  value={litPdiSearch}
                  onChange={(event) => setLitPdiSearch(event.target.value)}
                  placeholder="Search PDI…"
                  className="border border-[var(--section-rule)] bg-transparent px-2 py-1 text-xs text-[var(--section-ink)] placeholder:text-[var(--section-muted)] min-w-[9rem]"
                />
              </label>
              <input
                ref={litFlagsInputRef}
                type="file"
                accept=".csv,text/csv"
                multiple
                className="hidden"
                onChange={(event) => void importLitFlags(event.target.files)}
              />
              <button
                type="button"
                className={chipClass(false)}
                disabled={litFlagsImporting}
                onClick={() => litFlagsInputRef.current?.click()}
              >
                {litFlagsImporting ? "Importing flags…" : "Import lit flags CSV"}
              </button>
            </>
          ) : (
            <>
              <CheckboxFilterMenu
                label="Canvass projects"
                options={projectOptions}
                selected={projects}
                onSelectedChange={setProjects}
              />
              <CheckboxFilterMenu
                label="QC phone banks"
                options={qcPhonebankOptions}
                selected={qcPhonebanks}
                onSelectedChange={setQcPhonebanks}
              />
              <CheckboxFilterMenu
                label="Canvassers"
                options={canvasserOptions}
                selected={canvassersSelected}
                onSelectedChange={setCanvassersSelected}
                mode={canvasserMode}
                onModeChange={setCanvasserMode}
                groups={canvasserGroups.groups}
                onGroupsChange={canvasserGroups.setGroups}
              />
            </>
          )}
        </div>
        {mode === "recall" ? (
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Candidate</p>
            <div className="flex flex-wrap gap-1.5">
              {(payload?.candidates ?? []).map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => selectCandidate(candidate.id)}
                  className={chipClass(tagId === candidate.id)}
                  aria-pressed={tagId === candidate.id}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {mode === "lit" && litFlagsMessage ? (
          <p className="text-sm text-emerald-800 dark:text-emerald-300">{litFlagsMessage}</p>
        ) : null}
      </div>

      {mode === "lit" ? (
        <LitQcSection
          error={litError}
          loading={litLoading}
          hasLitQuestions={litPayload?.hasLitQuestions ?? false}
          loaded={litPayload !== null}
          rows={visibleLitCanvassers}
          totals={litTotals}
          voterTotal={litVoterTotal}
          openName={openName}
          onToggle={(name) => setOpenName((current) => (current === name ? null : name))}
          detailColumns={litDetailColumns}
          onToggleColumn={(id, on) => setLitColumns(toggleLitQcDetailColumn(litDetailColumns, id, on))}
          onDownloadCsv={downloadLitCsv}
          onCopyTable={() => void copyLitTable()}
          copyLabel={litCopyLabel}
          onImportFlags={() => litFlagsInputRef.current?.click()}
          flagsImporting={litFlagsImporting}
        />
      ) : error ? (
        <div className="border border-rose-200 dark:border-rose-900 bg-rose-50/80 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {mode === "recall" && !error && !selected ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a candidate to see canvasser QC recall.</p>
      ) : mode === "recall" && !error && !showing ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading canvasser overview…</p>
      ) : mode === "recall" && !error && payload && !payload.hasSnapshot ? (
        <div className="dash-card space-y-2">
          <p className="text-sm text-[var(--section-ink)]">
            No QC recontact snapshot for {payload.tagLabel || "this candidate"} yet.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Open the{" "}
            <Link href={`/phonebanking/${payload.qcTagId}#qc-recontacts`} className="underline underline-offset-2">
              QC phone bank page
            </Link>{" "}
            and refresh that candidate. This page reads the snapshot that page already builds.
          </p>
        </div>
      ) : mode === "recall" && !error ? (
        <div className="border border-[var(--section-rule)] overflow-hidden bg-[var(--section-paper)]">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[var(--section-rule)]">
            <div className="min-w-0 space-y-1">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {loading
                  ? "Updating…"
                  : `${formatNumber(visibleCanvassers.length)} canvassers · ${formatNumber(surveyedTotal)} surveyed`}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Click each canvasser name to show more details
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--section-muted)]">
                <input
                  type="checkbox"
                  checked={hasNotesOnly}
                  onChange={(event) => setHasNotesOnly(event.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                Has Notes
              </label>
              <OverviewDetailColumnControls
                visibleIds={detailColumns}
                onToggle={(id, on) => setColumns(toggleOverviewDetailColumn(detailColumns, id, on))}
                onDownloadCsv={downloadCsv}
                onCopyTable={() => void copyTable()}
                copyLabel={copyLabel}
                csvDisabled={!visibleCanvassers.length}
              />
            </div>
          </div>
          {!payload?.canvassers.length ? (
            <p className="px-4 py-8 text-sm text-center text-gray-500 dark:text-gray-400">
              No canvasser recontacts in this date range.
            </p>
          ) : !visibleCanvassers.length ? (
            <p className="px-4 py-8 text-sm text-center text-gray-500 dark:text-gray-400">
              No canvasser recontacts with notes in this date range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-collapse w-full text-xs min-w-max">
                <thead className="sticky top-0 z-10 bg-gray-800 text-white">
                  <tr>
                    <th rowSpan={2} className="px-2.5 py-2 text-left align-bottom">Canvasser</th>
                    <th rowSpan={2} className="px-2.5 py-2 text-right align-bottom">Surveyed</th>
                    <th rowSpan={2} className="px-2.5 py-2 text-right align-bottom">Originally strong support</th>
                    <th rowSpan={2} className="px-2.5 py-2 text-right align-bottom">Recall contact %</th>
                    <th rowSpan={2} className="px-2.5 py-2 text-right align-bottom">Strong support on polling %</th>
                    <th rowSpan={2} className="px-2.5 py-2 text-right align-bottom">Strong support after persuasion %</th>
                    <th colSpan={3} className="px-2.5 py-2 text-center border-l border-white/20">Contacted</th>
                    <th colSpan={4} className="px-2.5 py-2 text-center border-l border-white/20">
                      Originally strong support — polling
                    </th>
                    <th colSpan={4} className="px-2.5 py-2 text-center border-l border-white/20">
                      Originally strong support — final result
                    </th>
                    <th colSpan={4} className="px-2.5 py-2 text-center border-l border-white/20">
                      Originally undecided — final result
                    </th>
                  </tr>
                  <tr>
                    {["Yes", "Unsure", "No"].map((label, index) => (
                      <th
                        key={`contacted-${label}`}
                        className={`px-2.5 py-1.5 text-right font-medium ${index === 0 ? "border-l border-white/20" : ""}`}
                      >
                        {label}
                      </th>
                    ))}
                    {["polling", "final", "undecided"].map((group) =>
                      (["Surveyed", "Strong support", "Undecided", "Strong oppose"] as const).map((label, index) => (
                        <th
                          key={`${group}-${label}`}
                          className={`px-2.5 py-1.5 text-right font-medium ${index === 0 ? "border-l border-white/20" : ""}`}
                        >
                          {label}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {totals ? <OverviewTotalRow row={totals} /> : null}
                  {visibleCanvassers.map((row) => (
                    <CanvasserRows
                      key={row.canvasserName}
                      row={row}
                      open={openName === row.canvasserName}
                      onToggle={() => setOpenName((current) => (current === row.canvasserName ? null : row.canvasserName))}
                      detailColumns={detailColumns}
                      summaryColSpan={21}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PercentCell({ rate }: { rate: number | null }) {
  return (
    <td className={`px-2.5 py-1.5 text-right tabular-nums ${overviewPercentBandClass(rate)}`}>
      {formatOverviewPercent(rate)}
    </td>
  );
}

function OverviewTotalRow({ row }: { row: CanvasserOverviewRow }) {
  return (
    <tr className="border-b-2 border-gray-800 bg-gray-100 font-semibold dark:border-gray-200 dark:bg-gray-800">
      <td className="px-2.5 py-1.5">Total</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.surveyed)}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.originallyStrongSupport)}</td>
      <PercentCell rate={row.recallContactRate} />
      <PercentCell rate={row.strongSupportOnPollingRate} />
      <PercentCell rate={row.strongSupportAfterPersuasionRate} />
      <td className="px-2.5 py-1.5 text-right tabular-nums border-l border-[var(--section-rule)]">
        {formatNumber(row.contactedYes)}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.contactedUnsure)}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.contactedNo)}</td>
      <FamilyCells block={row.originalStrongSupportPolling} />
      <FamilyCells block={row.originalStrongSupportFinal} />
      <FamilyCells block={row.originalUndecidedFinal} />
    </tr>
  );
}

function CanvasserRows({
  row,
  open,
  onToggle,
  detailColumns,
  summaryColSpan,
}: {
  row: CanvasserOverviewRow;
  open: boolean;
  onToggle: () => void;
  detailColumns: readonly OverviewDetailColumnId[];
  summaryColSpan: number;
}) {
  return (
    <Fragment>
      <tr className="odd:bg-white even:bg-gray-50/70 dark:odd:bg-gray-900 dark:even:bg-gray-800/40">
        <td className="px-2.5 py-1.5 font-medium">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="underline-offset-2 hover:underline text-left"
          >
            {row.canvasserName}
          </button>
        </td>
        <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.surveyed)}</td>
        <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.originallyStrongSupport)}</td>
        <PercentCell rate={row.recallContactRate} />
        <PercentCell rate={row.strongSupportOnPollingRate} />
        <PercentCell rate={row.strongSupportAfterPersuasionRate} />
        <td className="px-2.5 py-1.5 text-right tabular-nums border-l border-[var(--section-rule)]">
          {formatNumber(row.contactedYes)}
        </td>
        <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.contactedUnsure)}</td>
        <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.contactedNo)}</td>
        <FamilyCells block={row.originalStrongSupportPolling} />
        <FamilyCells block={row.originalStrongSupportFinal} />
        <FamilyCells block={row.originalUndecidedFinal} />
      </tr>
      {open ? (
        <tr className="bg-[color-mix(in_srgb,var(--section-accent)_6%,transparent)]">
          <td colSpan={summaryColSpan} className="px-3 py-3">
            <DetailTable details={row.details} columnIds={detailColumns} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

const LIT_SUMMARY_COLUMNS = 11;

function formatQcStamp(iso: string): string {
  const parsed = DateTime.fromISO(iso, { setZone: true });
  if (!parsed.isValid) return iso || "—";
  return parsed.setZone("America/Los_Angeles").toFormat("M/d/yy h:mm a");
}

function LitDetailTable({
  details,
  columnIds,
}: {
  details: readonly LitQcDetailRow[];
  columnIds: readonly LitQcDetailColumnId[];
}) {
  const headers = litQcDetailHeaders(columnIds);
  return (
    <table className="border-collapse w-full text-xs min-w-max">
      <thead>
        <tr className="text-left text-gray-500 dark:text-gray-400">
          {headers.map((header) => (
            <th key={header} className="px-2.5 py-1.5 font-medium">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
        {details.map((detail, index) => (
          <tr key={`${detail.pdiId || "hh"}-${detail.qcTime}-${index}`}>
            {columnIds.map((id) => {
              let text = litQcDetailCellValue(detail, id);
              if (id === "projectDate" || id === "voterProjectDate") text = formatShortUsDate(text) || text;
              if (id === "qcTime") text = formatQcStamp(text);
              if (
                (id === "flyer" ||
                  id === "voterName" ||
                  id === "project" ||
                  id === "litObservation" ||
                  id === "originalMark") &&
                !text
              ) {
                text = "—";
              }
              const mono = id === "pdiId" ? "font-mono" : "";
              const nums =
                id === "projectDate" || id === "voterProjectDate" || id === "qcTime" ? "tabular-nums" : "";
              return (
                <td key={id} className={`px-2.5 py-1.5 ${mono} ${nums}`}>
                  {id === "qcTime" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span>{text || "—"}</span>
                      {detail.sameDoorGroup ? (
                        <span
                          className="border border-[var(--section-rule)] px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--section-muted)]"
                          title="Flags posted at the same time or within a minute are grouped as one household"
                        >
                          Grouped
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    text
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LitQcSection({
  error,
  loading,
  hasLitQuestions,
  loaded,
  rows,
  totals,
  voterTotal,
  openName,
  onToggle,
  detailColumns,
  onToggleColumn,
  onDownloadCsv,
  onCopyTable,
  copyLabel,
  onImportFlags,
  flagsImporting,
}: {
  error: string | null;
  loading: boolean;
  hasLitQuestions: boolean;
  loaded: boolean;
  rows: readonly LitQcCanvasserRow[];
  totals: LitQcCanvasserRow | null;
  voterTotal: number;
  openName: string | null;
  onToggle: (name: string) => void;
  detailColumns: readonly LitQcDetailColumnId[];
  onToggleColumn: (id: LitQcDetailColumnId, on: boolean) => void;
  onDownloadCsv: () => void;
  onCopyTable: () => void;
  copyLabel: string;
  onImportFlags: () => void;
  flagsImporting: boolean;
}) {
  if (error) {
    return (
      <div className="border border-rose-200 dark:border-rose-900 bg-rose-50/80 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
        {error}
      </div>
    );
  }
  if (!loaded) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading lit QC…</p>;
  }
  if (!hasLitQuestions) {
    return (
      <div className="dash-card space-y-2">
        <p className="text-sm text-[var(--section-ink)]">No lit observation flags in the knock index yet.</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Import a PDI flags CSV with Lit Observation and/or &quot;Did you receive our flyer?&quot; answers. Also keep
          Knock Analysis reports for the earlier not-home / lit-drop walks so households can match to the original
          canvasser.
        </p>
        <button type="button" className={chipClass(false)} disabled={flagsImporting} onClick={onImportFlags}>
          {flagsImporting ? "Importing flags…" : "Import lit flags CSV"}
        </button>
      </div>
    );
  }
  return (
    <div className="border border-[var(--section-rule)] overflow-hidden bg-[var(--section-paper)]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[var(--section-rule)]">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {loading
              ? "Updating…"
              : `${formatNumber(rows.length)} canvassers · ${formatNumber(voterTotal)} voters`}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Click each canvasser name to show more details</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ColumnChecklist
            columns={LIT_QC_DETAIL_COLUMNS}
            visibleIds={detailColumns}
            onToggle={onToggleColumn}
            menuLabel="Detail table columns"
          />
          <button type="button" className={chipClass(false)} disabled={!rows.length} onClick={onDownloadCsv}>
            Download CSV
          </button>
          <button type="button" className={chipClass(false)} disabled={!rows.length} onClick={onCopyTable}>
            {copyLabel}
          </button>
        </div>
      </div>
      {!rows.length ? (
        <p className="px-4 py-8 text-sm text-center text-gray-500 dark:text-gray-400">
          No lit QC households in this date range.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse w-full text-xs min-w-max">
            <thead className="sticky top-0 z-10 bg-gray-800 text-white">
              <tr>
                <th rowSpan={2} className="px-2.5 py-2 text-left align-bottom">Canvasser</th>
                <th rowSpan={2} className="px-2.5 py-2 text-right align-bottom">Households</th>
                <th rowSpan={2} className="px-2.5 py-2 text-right align-bottom">Voters</th>
                <th colSpan={4} className="px-2.5 py-2 text-center border-l border-white/20">Lit observation</th>
                <th colSpan={4} className="px-2.5 py-2 text-center border-l border-white/20">Received flyer</th>
              </tr>
              <tr>
                {["Saw lit", "Didn't see", "USA flag", "Saw lit %"].map((label, index) => (
                  <th
                    key={label}
                    className={`px-2.5 py-1.5 text-right font-medium ${index === 0 ? "border-l border-white/20" : ""}`}
                  >
                    {label}
                  </th>
                ))}
                {["Got flyer", "Didn't get", "Undecided", "Received %"].map((label, index) => (
                  <th
                    key={label}
                    className={`px-2.5 py-1.5 text-right font-medium ${index === 0 ? "border-l border-white/20" : ""}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totals ? <LitTotalRow row={totals} /> : null}
              {rows.map((row) => (
                <LitCanvasserRows
                  key={row.canvasserName}
                  row={row}
                  open={openName === row.canvasserName}
                  onToggle={() => onToggle(row.canvasserName)}
                  detailColumns={detailColumns}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LitMetricCells({ row }: { row: LitQcCanvasserRow }) {
  return (
    <>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.householdsChecked)}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.votersChecked)}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums border-l border-[var(--section-rule)]">
        {formatNumber(row.sawLit)}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.didntSeeLit)}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.usaFlag)}</td>
      <PercentCell rate={row.sawLitRate} />
      <td className="px-2.5 py-1.5 text-right tabular-nums border-l border-[var(--section-rule)]">
        {formatNumber(row.gotFlyer)}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.didntGetFlyer)}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{formatNumber(row.flyerUndecided)}</td>
      <PercentCell rate={row.receivedRate} />
    </>
  );
}

function LitTotalRow({ row }: { row: LitQcCanvasserRow }) {
  return (
    <tr className="border-b-2 border-gray-800 bg-gray-100 font-semibold dark:border-gray-200 dark:bg-gray-800">
      <td className="px-2.5 py-1.5">Total</td>
      <LitMetricCells row={row} />
    </tr>
  );
}

function LitCanvasserRows({
  row,
  open,
  onToggle,
  detailColumns,
}: {
  row: LitQcCanvasserRow;
  open: boolean;
  onToggle: () => void;
  detailColumns: readonly LitQcDetailColumnId[];
}) {
  const details = flattenLitQcDetails([row]);
  return (
    <Fragment>
      <tr className="odd:bg-white even:bg-gray-50/70 dark:odd:bg-gray-900 dark:even:bg-gray-800/40">
        <td className="px-2.5 py-1.5 font-medium">
          <button type="button" onClick={onToggle} aria-expanded={open} className="underline-offset-2 hover:underline text-left">
            {row.canvasserName}
          </button>
        </td>
        <LitMetricCells row={row} />
      </tr>
      {open ? (
        <tr className="bg-[color-mix(in_srgb,var(--section-accent)_6%,transparent)]">
          <td colSpan={LIT_SUMMARY_COLUMNS} className="px-3 py-3">
            <LitDetailTable details={details} columnIds={detailColumns} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
