"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OverviewDetailColumnControls from "@/components/canvassing/OverviewDetailColumnControls";
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
    "border px-2.5 py-1 text-xs font-medium",
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

  useEffect(() => {
    setDetailColumns(loadOverviewDetailColumnIds(CANVASSER_OVERVIEW_DETAIL_COLS_STORAGE_KEY));
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

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview]);

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

  const selected = Boolean(tagId);
  const showing = Boolean(payload && payload.tagId === tagId);

  return (
    <div className="space-y-5">
      <div>
        <p className="section-kicker text-teal-800 dark:text-teal-300">Field / QC</p>
        <h1 className="font-display text-3xl font-semibold text-[var(--section-ink)]">Canvasser QC Overview</h1>
        <hr className="section-hero__rule bg-teal-700 dark:bg-teal-300" />
        <p className="section-hero__lede">
          QC calls that reached the voter, grouped by the canvasser who originally ID’d them. Recall
          contact is Yes ÷ (Yes+Unsure+No) on “Were you contacted?” — calls with no answer
          (e.g. GOTV scripts) do not dilute the rate. Strong support rates use only the voters that
          canvasser originally marked strong support.
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
          label="QC call date"
          helpText="Clear to include every saved QC day. Dates are the QC call date."
          minDate={payload?.minDate || undefined}
          maxDate={payload?.maxDate || undefined}
          allowEmpty
          tone="emerald"
        />
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
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
      </div>

      {error ? (
        <div className="border border-rose-200 dark:border-rose-900 bg-rose-50/80 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {!selected ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a candidate to see canvasser QC recall.</p>
      ) : !showing ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading canvasser overview…</p>
      ) : payload && !payload.hasSnapshot ? (
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
      ) : (
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
      )}
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
