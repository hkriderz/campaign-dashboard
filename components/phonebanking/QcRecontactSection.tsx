"use client";

import { useMemo, useState } from "react";
import { writeTextToClipboard } from "@/lib/browser-clipboard";
import { downloadCsvFile } from "@/lib/pivot-csv-export";
import {
  buildRecontactPairsCsv,
  buildRecontactTableTsv,
  changeKindLabel,
  displayRecontactResultLabel,
  emptyRecontactSelection,
  matchesPdiOrNameQuery,
  pairIsUsefulRecontact,
  pairWithSupportAnswers,
  pairMatchesChannelChip,
  pairMatchesMatchChip,
  pairMatchesOutcomeChip,
  pairMatchesSelections,
  priorActorNamesForPairs,
  qcCallerNamesForPairs,
  recontactChannelLabel,
  recontactExportFilename,
  summarizeRecontactPairs,
  type QcRecontactChangeKind,
  type QcRecontactPair,
  type RecontactChannelFilter,
  type RecontactMatchFilter,
  type RecontactOutcomeFilter,
} from "@/lib/qc-recontact";
import { formatShortUsDate } from "@/lib/slice-key";
import type { SurveyScriptProfile } from "@/lib/types";
import QcRecontactModal from "./QcRecontactModal";

const CHANNEL_CHIPS: Array<{ id: RecontactChannelFilter; label: string }> = [
  { id: "phonebank", label: "Phone" },
  { id: "canvass", label: "Canvass" },
  { id: "text", label: "Text" },
];

const OUTCOME_CHIPS: Array<{ id: RecontactOutcomeFilter; label: string }> = [
  { id: "held", label: "Held" },
  { id: "strengthened", label: "Strengthened" },
  { id: "softened", label: "Softened" },
  { id: "flipped", label: "Flipped" },
  { id: "no_reply", label: "No Reply" },
];

const MATCH_CHIPS: Array<{ id: RecontactMatchFilter; label: string }> = [
  { id: "unmatched", label: "Unmatched" },
  { id: "no_pdi", label: "No PDI" },
];

const RECONTACT_PAGE_SIZE = 100;

function toggleValue<T extends string>(list: readonly T[], id: T): T[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function chipClass(active: boolean): string {
  return [
    "rounded-full border px-2.5 py-1 text-xs font-medium",
    active
      ? "border-indigo-400 bg-indigo-50 text-indigo-800 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200"
      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300",
  ].join(" ");
}

function changeBadgeClass(kind: QcRecontactChangeKind): string {
  switch (kind) {
    case "held":
      return "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800";
    case "strengthened":
      return "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-800";
    case "softened":
      return "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800";
    case "flipped":
      return "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800";
    default:
      return "bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
  }
}

function PersonFilter({
  id,
  label,
  emptyLabel,
  value,
  names,
  onChange,
}: {
  id: string;
  label: string;
  emptyLabel: string;
  value: string;
  names: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-[12rem] rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 sm:w-auto"
      >
        <option value="">{emptyLabel}</option>
        {value && !names.includes(value) ? <option value={value}>{value}</option> : null}
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

type Props = {
  tagId: string;
  pairs: QcRecontactPair[];
  hasSnapshot: boolean;
  surveyScriptProfile: SurveyScriptProfile;
};

export default function QcRecontactSection({
  tagId,
  pairs,
  hasSnapshot,
  surveyScriptProfile,
}: Props) {
  const [selection, setSelection] = useState(emptyRecontactSelection);
  const [pdiQuery, setPdiQuery] = useState("");
  const [page, setPage] = useState(1);
  const [openPair, setOpenPair] = useState<QcRecontactPair | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const scopedPairs = useMemo(
    () =>
      pairs
        .filter((pair) => pairIsUsefulRecontact(pair, surveyScriptProfile))
        .map((pair) => pairWithSupportAnswers(pair, surveyScriptProfile)),
    [pairs, surveyScriptProfile]
  );
  const stats = useMemo(() => summarizeRecontactPairs(scopedPairs), [scopedPairs]);
  const searchQuery = pdiQuery.trim();
  const filterKey = [
    searchQuery,
    selection.priorActor,
    selection.qcCaller,
    selection.channels.join("\0"),
    selection.outcomes.join("\0"),
    selection.matches.join("\0"),
  ].join("|");
  const [trackedFilterKey, setTrackedFilterKey] = useState(filterKey);
  if (trackedFilterKey !== filterKey) {
    setTrackedFilterKey(filterKey);
    setPage(1);
  }
  const visible = useMemo(
    () =>
      scopedPairs.filter((pair) => {
        if (!pairMatchesSelections(pair, selection)) return false;
        return matchesPdiOrNameQuery(pdiQuery, pair.qc.pdiId, pair.qc.voterName ?? "");
      }),
    [scopedPairs, selection, pdiQuery]
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / RECONTACT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * RECONTACT_PAGE_SIZE, safePage * RECONTACT_PAGE_SIZE);
  const channelCounts = useMemo(() => {
    const counts = {} as Record<RecontactChannelFilter, number>;
    for (const chip of CHANNEL_CHIPS) {
      counts[chip.id] = scopedPairs.filter((pair) => pairMatchesChannelChip(pair, chip.id)).length;
    }
    return counts;
  }, [scopedPairs]);
  const outcomeCounts = useMemo(() => {
    const counts = {} as Record<RecontactOutcomeFilter, number>;
    for (const chip of OUTCOME_CHIPS) {
      counts[chip.id] = scopedPairs.filter((pair) => pairMatchesOutcomeChip(pair, chip.id)).length;
    }
    return counts;
  }, [scopedPairs]);
  const priorActorNames = useMemo(() => priorActorNamesForPairs(scopedPairs), [scopedPairs]);
  const qcCallerNames = useMemo(() => qcCallerNamesForPairs(scopedPairs), [scopedPairs]);
  const matchCounts = useMemo(() => {
    const counts = {} as Record<RecontactMatchFilter, number>;
    for (const chip of MATCH_CHIPS) {
      counts[chip.id] = scopedPairs.filter((pair) => pairMatchesMatchChip(pair, chip.id)).length;
    }
    return counts;
  }, [scopedPairs]);

  function exportCsv(): string {
    return buildRecontactPairsCsv(visible, surveyScriptProfile);
  }

  async function copyTable() {
    setExportMessage(null);
    setExportError(null);
    if (visible.length === 0) {
      setExportError("No recontact rows to copy for this filter.");
      return;
    }
    try {
      await writeTextToClipboard(buildRecontactTableTsv(visible, surveyScriptProfile));
      setExportMessage(
        `Copied ${visible.length.toLocaleString()} recontact row${visible.length === 1 ? "" : "s"}. Paste into a spreadsheet to keep each column in its own cell.`
      );
    } catch {
      setExportError("Unable to copy the table. Your browser may be blocking clipboard access.");
    }
  }

  function downloadCsv() {
    setExportMessage(null);
    setExportError(null);
    if (visible.length === 0) {
      setExportError("No recontact rows to download for this filter.");
      return;
    }
    downloadCsvFile(exportCsv(), recontactExportFilename(tagId, visible));
    setExportMessage(`Downloaded ${visible.length.toLocaleString()} recontact row${visible.length === 1 ? "" : "s"}.`);
  }

  const flipCells: Array<{ id: RecontactOutcomeFilter; label: string; count: number }> = [
    { id: "held", label: "Held", count: stats.held },
    { id: "strengthened", label: "Strengthened", count: stats.strengthened },
    { id: "softened", label: "Softened", count: stats.softened },
    { id: "flipped", label: "Flipped", count: stats.flipped },
  ];

  return (
    <section id="qc-recontacts" className="scroll-mt-24 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-700 dark:text-gray-200">Recontacts</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            QC calls that reached the correct person and recorded an answer, matched to prior phone-bank, canvass, and text contacts.
            Combine chips across rows. No Reply is a text prior with no inbound voter message.
          </p>
        </div>
        {hasSnapshot ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void copyTable()}
              disabled={visible.length === 0}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Copy table
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={visible.length === 0}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Download CSV
            </button>
          </div>
        ) : null}
      </div>
      {hasSnapshot ? (
        exportError ? (
          <p className="text-xs text-rose-700 dark:text-rose-300">{exportError}</p>
        ) : exportMessage ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">{exportMessage}</p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Copy table pastes into a spreadsheet as columns. Download CSV is the full export (one row per prior).
          </p>
        )
      ) : null}

      {!hasSnapshot ? (
        <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/25 px-3 py-3 text-sm text-amber-950 dark:text-amber-100">
          Refresh this tag to build recontact matches.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Channel
              </p>
              <div className="flex flex-wrap gap-1.5">
                {CHANNEL_CHIPS.map((chip) => {
                  const active = selection.channels.includes(chip.id);
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelection((prev) => ({ ...prev, channels: toggleValue(prev.channels, chip.id) }))
                      }
                      className={chipClass(active)}
                    >
                      {chip.label}{" "}
                      <span className="tabular-nums text-[11px] opacity-80">
                        {(channelCounts[chip.id] ?? 0).toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Outcome
              </p>
              <div className="flex flex-wrap gap-1.5">
                {OUTCOME_CHIPS.map((chip) => {
                  const active = selection.outcomes.includes(chip.id);
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelection((prev) => ({ ...prev, outcomes: toggleValue(prev.outcomes, chip.id) }))
                      }
                      className={chipClass(active)}
                    >
                      {chip.label}{" "}
                      <span className="tabular-nums text-[11px] opacity-80">
                        {(outcomeCounts[chip.id] ?? 0).toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Match
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MATCH_CHIPS.map((chip) => {
                  const active = selection.matches.includes(chip.id);
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelection((prev) => ({ ...prev, matches: toggleValue(prev.matches, chip.id) }))
                      }
                      className={chipClass(active)}
                    >
                      {chip.label}{" "}
                      <span className="tabular-nums text-[11px] opacity-80">
                        {(matchCounts[chip.id] ?? 0).toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <PersonFilter
                id="qc-recontact-prior"
                label="Prior"
                emptyLabel="All prior callers"
                value={selection.priorActor}
                names={priorActorNames}
                onChange={(priorActor) => setSelection((prev) => ({ ...prev, priorActor }))}
              />
              <PersonFilter
                id="qc-recontact-qc"
                label="QC"
                emptyLabel="All QC callers"
                value={selection.qcCaller}
                names={qcCallerNames}
                onChange={(qcCaller) => setSelection((prev) => ({ ...prev, qcCaller }))}
              />
              <div>
                <label
                  htmlFor="qc-recontact-pdi"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  PDI / name
                </label>
                <input
                  id="qc-recontact-pdi"
                  type="search"
                  value={pdiQuery}
                  onChange={(event) => setPdiQuery(event.target.value)}
                  placeholder="Search PDI or name"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full min-w-[12rem] rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 sm:w-auto"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {flipCells.map((cell) => {
              const active = selection.outcomes.includes(cell.id);
              return (
                <button
                  key={cell.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setSelection((prev) => ({ ...prev, outcomes: toggleValue(prev.outcomes, cell.id) }))
                  }
                  className={[
                    "rounded-lg border px-3 py-2 text-left text-xs",
                    active
                      ? "border-indigo-400 bg-indigo-50/80 dark:border-indigo-600 dark:bg-indigo-950/30"
                      : "border-gray-200 bg-gray-50/40 dark:border-gray-700 dark:bg-gray-800/30",
                  ].join(" ")}
                >
                  <div className="text-gray-500 dark:text-gray-400">{cell.label}</div>
                  <div className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                    {cell.count.toLocaleString()}
                  </div>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 px-3 py-6 text-sm text-center text-gray-500 dark:text-gray-400">
              {scopedPairs.length === 0
                ? "No QC calls that reached the correct person and recorded an answer in this date range."
                : searchQuery
                  ? "No recontact rows match that PDI or name."
                  : "No recontact rows for this filter combination."}
            </div>
          ) : (
            <>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Change</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">PDI</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Prior</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Prior result</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">QC</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Were you contacted</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">QC polling</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">QC result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {pageRows.map((pair) => {
                    const priors = pair.priors;
                    return (
                      <tr
                        key={pair.pairId}
                        tabIndex={0}
                        role="button"
                        className="hover:bg-indigo-50/40 dark:hover:bg-gray-800 cursor-pointer"
                        onClick={() => setOpenPair(pair)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setOpenPair(pair);
                          }
                        }}
                      >
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${changeBadgeClass(pair.changeKind)}`}
                          >
                            {changeKindLabel(pair.changeKind)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-800 dark:text-gray-200">
                          <div className="font-mono">{pair.qc.pdiId || "—"}</div>
                          <div>{pair.qc.voterName?.trim() || "—"}</div>
                          <div className="text-gray-500 dark:text-gray-400">{pair.qc.voterAddress?.trim() || "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-800 dark:text-gray-200">
                          {priors.length ? (
                            <div className="space-y-2">
                              {priors.map((item, index) => (
                                <div key={`${item.channel}-${item.callId ?? item.callAt ?? item.occurredOn}-${index}`}>
                                  <div className="font-medium">{item.actorName || "—"}</div>
                                  <div className="text-gray-500 dark:text-gray-400">
                                    {recontactChannelLabel(item.channel)} · {formatShortUsDate(item.occurredOn)}
                                  </div>
                                  <div className="text-gray-500 dark:text-gray-400">{item.listOrAssignment}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">
                              {pair.matchStatus === "no_pdi" ? "No PDI on QC call" : "No prior contact"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {priors.length
                            ? priors.map((item, index) => (
                                <div key={`${item.resultLabel}-${index}`} className={index > 0 ? "mt-2" : undefined}>
                                  {displayRecontactResultLabel(item.resultLabel, surveyScriptProfile) || "—"}
                                </div>
                              ))
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-800 dark:text-gray-200">
                          <div className="font-medium">{pair.qc.phonebankerName || "—"}</div>
                          <div className="text-gray-500 dark:text-gray-400">
                            {formatShortUsDate(pair.qc.callDate)}
                          </div>
                          <div className="text-gray-500 dark:text-gray-400">{pair.qc.campaignName}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-800 dark:text-gray-200">
                          {pair.qc.contactedAnswer?.trim() || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {displayRecontactResultLabel(pair.qc.pollingLabel, surveyScriptProfile) || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {displayRecontactResultLabel(pair.qc.finalResultLabel, surveyScriptProfile) || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <p className="text-gray-500 dark:text-gray-400">
                Page {safePage} of {pageCount}
                {visible.length > RECONTACT_PAGE_SIZE
                  ? ` · ${visible.length.toLocaleString()} rows`
                  : ""}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage <= 1}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Next
                </button>
              </div>
            </div>
            </>
          )}
        </>
      )}

      <QcRecontactModal
        tagId={tagId}
        pair={openPair}
        surveyScriptProfile={surveyScriptProfile}
        onClose={() => setOpenPair(null)}
      />
    </section>
  );
}
