"use client";

import { useMemo, useState } from "react";
import { writeTextToClipboard } from "@/lib/browser-clipboard";
import { downloadCsvFile } from "@/lib/pivot-csv-export";
import {
  buildRecontactPairsCsv,
  changeKindLabel,
  displayRecontactResultLabel,
  pairHasQcContact,
  pairMatchesFilter,
  recontactChannelLabel,
  recontactExportFilename,
  summarizeRecontactPairs,
  type QcRecontactChangeKind,
  type QcRecontactFilter,
  type QcRecontactPair,
} from "@/lib/qc-recontact";
import { formatShortUsDate } from "@/lib/slice-key";
import type { SurveyScriptProfile } from "@/lib/types";
import QcRecontactModal from "./QcRecontactModal";

const CHIP_FILTERS: Array<{ id: QcRecontactFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "phonebank", label: "Phone bank" },
  { id: "canvass", label: "Canvass" },
  { id: "changed", label: "Changed" },
  { id: "held", label: "Held" },
  { id: "unmatched", label: "Unmatched" },
  { id: "no_pdi", label: "No PDI" },
];

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
  const [filter, setFilter] = useState<QcRecontactFilter>("all");
  const [hideNoQcContact, setHideNoQcContact] = useState(false);
  const [openPair, setOpenPair] = useState<QcRecontactPair | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const missingQcContactCount = useMemo(
    () => pairs.filter((pair) => !pairHasQcContact(pair)).length,
    [pairs]
  );
  const scopedPairs = useMemo(
    () => (hideNoQcContact ? pairs.filter(pairHasQcContact) : pairs),
    [pairs, hideNoQcContact]
  );
  const stats = useMemo(() => summarizeRecontactPairs(scopedPairs), [scopedPairs]);
  const visible = useMemo(
    () => scopedPairs.filter((pair) => pairMatchesFilter(pair, filter)),
    [scopedPairs, filter]
  );
  const chipCounts = useMemo(() => {
    const counts = {} as Record<QcRecontactFilter, number>;
    for (const chip of CHIP_FILTERS) {
      counts[chip.id] = scopedPairs.filter((pair) => pairMatchesFilter(pair, chip.id)).length;
    }
    return counts;
  }, [scopedPairs]);

  function exportCsv(): string {
    return buildRecontactPairsCsv(visible, surveyScriptProfile);
  }

  async function copyCsv() {
    setExportMessage(null);
    setExportError(null);
    if (visible.length === 0) {
      setExportError("No recontact rows to copy for this filter.");
      return;
    }
    try {
      await writeTextToClipboard(exportCsv());
      setExportMessage(`Copied ${visible.length.toLocaleString()} recontact row${visible.length === 1 ? "" : "s"} as CSV.`);
    } catch {
      setExportError("Unable to copy CSV. Your browser may be blocking clipboard access.");
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

  const flipCells: Array<{ id: QcRecontactFilter; label: string; count: number }> = [
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
            QC calls matched to prior phone-bank and canvass contacts for the same PDI. Change uses the latest prior.
          </p>
        </div>
        {hasSnapshot ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void copyCsv()}
              disabled={visible.length === 0}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Copy CSV
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
            Copy or download the current filter as CSV (one row per prior; empty prior columns when unmatched).
          </p>
        )
      ) : null}

      {!hasSnapshot ? (
        <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/25 px-3 py-3 text-sm text-amber-950 dark:text-amber-100">
          Refresh this tag to build recontact matches.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {CHIP_FILTERS.map((chip) => {
              const active = filter === chip.id;
              const count = chipCounts[chip.id] ?? 0;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilter(chip.id)}
                  className={[
                    "rounded-full border px-2.5 py-1 text-xs font-medium",
                    active
                      ? "border-indigo-400 bg-indigo-50 text-indigo-800 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300",
                  ].join(" ")}
                >
                  {chip.label}{" "}
                  <span className="tabular-nums text-[11px] opacity-80">{count.toLocaleString()}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setHideNoQcContact((on) => !on)}
              className={[
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                hideNoQcContact
                  ? "border-rose-400 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300",
              ].join(" ")}
            >
              Hide no QC contact{" "}
              <span className="tabular-nums text-[11px] opacity-80">
                {missingQcContactCount.toLocaleString()}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {flipCells.map((cell) => {
              const active = filter === cell.id;
              return (
                <button
                  key={cell.id}
                  type="button"
                  onClick={() => setFilter(cell.id)}
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
                ? hideNoQcContact
                  ? "No QC calls with a Final Result in this date range."
                  : "No QC calls with PDI in this date range."
                : "No recontact rows for this filter."}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Change</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">PDI</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Prior</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Prior result</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">QC</th>
                    <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">QC result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {visible.map((pair) => {
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
                        <td className="px-3 py-2 font-mono text-xs text-gray-800 dark:text-gray-200">
                          {pair.qc.pdiId || "—"}
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
                        <td className="px-3 py-2 text-xs">
                          {displayRecontactResultLabel(pair.qc.finalResultLabel, surveyScriptProfile) || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
