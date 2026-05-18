"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AggregateAnswerLine } from "@/lib/daily-aggregate-survey-rollup";
import { sumAnswerLines } from "@/lib/daily-aggregate-survey-rollup";
import type { DashboardAggregateLexicon } from "@/lib/dashboard-aggregate-lexicon";
import {
  DEFAULT_DAILY_AGGREGATE_LAYOUT,
  layoutStorageKey,
  parseDailyAggregateLayout,
  SLOT_KEYS,
  SLOT_LABELS,
  type AggregateSlotConfig,
  type DailyAggregateLayoutV1,
} from "@/lib/daily-aggregate-layout";
import {
  buildRollupsByQuestionName,
  mergeRollupsForQuestionGroup,
  resolveQuestionNamesForCanonicalKey,
  uniqueQuestionNamesSorted,
  type AggregateScopeQuestionRow,
} from "@/lib/daily-aggregate-question-rollups";
import { questionCanonicalGroupKey } from "@/lib/survey-i18n/column-label-gloss";
import { groupQuestionNamesForPicker, pickDisplayQuestionName } from "@/lib/survey-question-dedupe";
import { formatCallsPerLoggedInHour } from "@/lib/calls-rate";
import type { PbDashboardSlice } from "./PbDashboardStack";
import type { SurveyScriptProfile } from "@/lib/types";
import { isTraciViolationLayoutCanonicalKey, isTraciViolationQuestionName } from "@/lib/survey-i18n/rules";

function secToTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function AnswerBreakdownList({
  title,
  lines,
  denominatorHint,
}: {
  title: string;
  lines: AggregateAnswerLine[];
  denominatorHint?: number;
}) {
  const denom = sumAnswerLines(lines);
  const d = denom > 0 ? denom : denominatorHint ?? 0;

  return (
    <>
      <div className="font-semibold text-gray-700 dark:text-gray-200">{title}</div>
      {lines.length === 0 ? (
        <div className="text-gray-500 dark:text-gray-400">
          No matching responses in BigQuery for this scope.
        </div>
      ) : (
        <>
          <div className="text-gray-600 dark:text-gray-400">
            {denom.toLocaleString()} responses
            {denominatorHint != null && denominatorHint > 0 && denom !== denominatorHint ? (
              <span> · {denominatorHint.toLocaleString()} surveyed (slice)</span>
            ) : null}
          </div>
          {lines.map((line) => (
            <div
              key={line.label}
              className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 py-px border-b border-gray-100/80 dark:border-gray-700/50 last:border-b-0"
            >
              <span className="tabular-nums font-medium text-gray-900 dark:text-gray-100 shrink-0">
                {line.count.toLocaleString()}
              </span>
              <span className="text-gray-800 dark:text-gray-100 min-w-0 flex-1">{line.label}</span>
              <span className="text-gray-600 dark:text-gray-400 tabular-nums shrink-0">
                {pct(line.count, d)}
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function questionTitle(q: string): string {
  const t = q.trim();
  if (t.length <= 72) return t;
  return `${t.slice(0, 69)}…`;
}

/** Fallback heading when no BQ rows match this canonical key on the selected date. */
function displayTitleFromCanonicalKey(canonicalKey: string): string {
  const ck = canonicalKey.trim();
  const i = ck.indexOf("::");
  if (i === -1) return ck;
  const idx = ck.slice(0, i);
  const rest = ck.slice(i + 2).trim();
  return rest ? `${idx} · ${rest}` : ck;
}

type Props = {
  tagId: string;
  basePath: string;
  activeTab: string;
  availableDates: string[];
  activeDate: string;
  dateLabel: string;
  slices: PbDashboardSlice[];
  uniquePhonebankers: number;
  showPollingAggregate?: boolean;
  bqPollingBreakdown: AggregateAnswerLine[];
  bqFinalResultBreakdown: AggregateAnswerLine[];
  finalResultFromCallFill: boolean;
  aggregateLexicon: DashboardAggregateLexicon;
  finalResultUsesScriptOptionLabels: boolean;
  aggregateScopeRows: AggregateScopeQuestionRow[];
  surveyScriptProfile: SurveyScriptProfile;
};

function slotCellClass(isTraciViolation: boolean): string {
  const base =
    "daily-aggregate-slot space-y-0.5 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700";
  if (isTraciViolation) {
    return `${base} bg-rose-50/50 dark:bg-rose-950/20`;
  }
  return `${base} bg-gray-50/40 dark:bg-gray-800/30`;
}

export default function DailyAggregateSection({
  tagId,
  basePath,
  activeTab,
  availableDates,
  activeDate,
  dateLabel,
  slices,
  uniquePhonebankers,
  showPollingAggregate = true,
  bqPollingBreakdown,
  bqFinalResultBreakdown,
  finalResultFromCallFill,
  aggregateLexicon,
  finalResultUsesScriptOptionLabels,
  aggregateScopeRows,
  surveyScriptProfile,
}: Props) {
  const router = useRouter();
  const [layout, setLayout] = useState<DailyAggregateLayoutV1>(DEFAULT_DAILY_AGGREGATE_LAYOUT);
  const [hydrated, setHydrated] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DailyAggregateLayoutV1>(DEFAULT_DAILY_AGGREGATE_LAYOUT);

  useEffect(() => {
    const raw = localStorage.getItem(layoutStorageKey(tagId));
    const parsed = parseDailyAggregateLayout(raw, { surveyScriptProfile });
    setLayout(parsed ?? DEFAULT_DAILY_AGGREGATE_LAYOUT);
    setHydrated(true);
  }, [tagId, surveyScriptProfile]);

  const rollupsByQuestion = useMemo(
    () => buildRollupsByQuestionName(aggregateScopeRows),
    [aggregateScopeRows]
  );
  const questionPickerGroups = useMemo(
    () =>
      groupQuestionNamesForPicker(uniqueQuestionNamesSorted(aggregateScopeRows), surveyScriptProfile),
    [aggregateScopeRows, surveyScriptProfile]
  );

  const openModal = useCallback(() => {
    setDraft(layout);
    setModalOpen(true);
  }, [layout]);

  const saveLayout = useCallback(() => {
    try {
      localStorage.setItem(layoutStorageKey(tagId), JSON.stringify(draft));
      setLayout(draft);
      setModalOpen(false);
    } catch {
      setModalOpen(false);
    }
  }, [draft, tagId]);

  if (!slices.length) return null;

  const totals = slices.reduce(
    (acc, s) => {
      acc.phoneBanks += 1;
      acc.pbers += s.pbers;
      acc.callsAnswered += s.callsAnswered;
      acc.loggedInSeconds += s.loggedInSeconds;
      acc.callSeconds += s.callSeconds;
      return acc;
    },
    { phoneBanks: 0, pbers: 0, callsAnswered: 0, loggedInSeconds: 0, callSeconds: 0 }
  );

  const pberCount = uniquePhonebankers > 0 ? uniquePhonebankers : totals.pbers;
  const pollingSurveyed = slices.reduce((s, x) => s + x.surveyed, 0);
  const pollingFaizah = slices.reduce((s, x) => s + x.pollingFaizah, 0);
  const pollingAntiTraci = slices.reduce((s, x) => s + x.pollingAntiTraci, 0);
  const pollingUndecided = slices.reduce((s, x) => s + x.pollingUndecided, 0);
  const pollingTraci = slices.reduce((s, x) => s + x.pollingTraci, 0);
  const finalTotal = slices.reduce((s, x) => s + x.finalTotal, 0);
  const finalSS = slices.reduce((s, x) => s + x.finalSS, 0);
  const finalAntiTraci = slices.reduce((s, x) => s + x.finalAntiTraci, 0);
  const finalUndecided = slices.reduce((s, x) => s + x.finalUndecided, 0);
  const finalSO = slices.reduce((s, x) => s + x.finalSO, 0);

  const hrsPerPber = pberCount ? (totals.loggedInSeconds / 3600 / pberCount).toFixed(2) : "0.00";
  const secsPerCall = totals.callsAnswered ? Math.round(totals.callSeconds / totals.callsAnswered) : 0;

  const useBqPolling = bqPollingBreakdown.length > 0;
  const useBqFinal = bqFinalResultBreakdown.length > 0;

  const effectiveLayout = hydrated ? layout : DEFAULT_DAILY_AGGREGATE_LAYOUT;

  function renderSlot(config: AggregateSlotConfig): ReactNode {
    if (config.kind === "none") {
      return (
        <div
          className={`${slotCellClass(false)} daily-aggregate-slot--empty border border-dashed flex items-center justify-center text-gray-500 dark:text-gray-400`}
        >
          Empty slot
        </div>
      );
    }

    if (config.kind === "preset" && config.preset === "polling") {
      if (!showPollingAggregate) {
        return (
          <div className={slotCellClass(false)}>
            <div className="font-semibold text-gray-700 dark:text-gray-200">Polling</div>
            <p className="text-gray-500 dark:text-gray-400">Polling aggregate is off for this tag.</p>
          </div>
        );
      }
      return (
        <div className={slotCellClass(false)}>
          {useBqPolling ? (
            <AnswerBreakdownList
              title="Polling"
              lines={bqPollingBreakdown}
              denominatorHint={pollingSurveyed > 0 ? pollingSurveyed : undefined}
            />
          ) : (
            <>
              <div className="font-semibold text-gray-700 dark:text-gray-200">Polling</div>
              <div>{pollingSurveyed} Surveyed</div>
              <div>
                {pollingFaizah} {aggregateLexicon.pollingSupportRowLabel}
              </div>
              <div>
                {pollingAntiTraci} {aggregateLexicon.pollingSecondaryRowLabel}
              </div>
              <div>{pollingUndecided} Undecided</div>
              <div>{pollingTraci} Traci</div>
            </>
          )}
        </div>
      );
    }

    if (config.kind === "preset" && config.preset === "final") {
      return (
        <div className={slotCellClass(false)}>
          {useBqFinal ? (
            <>
              {finalResultUsesScriptOptionLabels ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Option labels match your phone bank script (exact Final Result answers in BigQuery
                  {finalResultFromCallFill
                    ? "; some rows come from per-call fill when the rollup had no Final Result"
                    : ""}
                  ).
                </p>
              ) : finalResultFromCallFill ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Per-call totals from the last substantive survey answer (STW labels). Shown when no “Final
                  Result” / “Resultado final” question appears in the rollup.
                </p>
              ) : null}
              <AnswerBreakdownList
                title="Final Result"
                lines={bqFinalResultBreakdown}
                denominatorHint={finalTotal > 0 ? finalTotal : undefined}
              />
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
              <div className="font-semibold text-gray-700 dark:text-gray-200 sm:col-span-2">Final Result</div>
              <div>{finalTotal} TOTAL</div>
              <div>
                {finalSS} {aggregateLexicon.finalFallbackSSLabel}
              </div>
              <div>
                {finalAntiTraci} {aggregateLexicon.finalFallbackOtherPositiveLabel}
              </div>
              <div>{finalUndecided} Undecided</div>
              <div className="sm:col-span-2">
                {finalSO} {aggregateLexicon.finalFallbackSOLabel}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (config.kind === "question") {
      const names = resolveQuestionNamesForCanonicalKey(
        config.canonicalKey,
        aggregateScopeRows,
        surveyScriptProfile
      );
      const lines = mergeRollupsForQuestionGroup(rollupsByQuestion, names, surveyScriptProfile);
      const traci =
        names.length > 0
          ? names.some((n) => isTraciViolationQuestionName(n))
          : isTraciViolationLayoutCanonicalKey(config.canonicalKey);
      const title = questionTitle(
        names.length ? pickDisplayQuestionName(names) : displayTitleFromCanonicalKey(config.canonicalKey)
      );
      return (
        <div className={slotCellClass(traci)}>
          <AnswerBreakdownList title={title} lines={lines} />
        </div>
      );
    }

    return null;
  }

  function slotSelectValue(config: AggregateSlotConfig): string {
    if (config.kind === "none") return "__none__";
    if (config.kind === "preset") return `__preset:${config.preset}`;
    const ck = config.canonicalKey.trim();
    if (!ck) return "__none__";
    return `__k__${encodeURIComponent(ck)}`;
  }

  function parseSlotSelectValue(v: string): AggregateSlotConfig {
    if (v === "__none__") return { kind: "none" };
    if (v === "__preset:polling") return { kind: "preset", preset: "polling" };
    if (v === "__preset:final") return { kind: "preset", preset: "final" };
    if (v.startsWith("__k__")) {
      try {
        const raw = decodeURIComponent(v.slice(5)).trim();
        if (raw) return { kind: "question", canonicalKey: raw };
      } catch {
        return { kind: "none" };
      }
    }
    if (v.startsWith("__g__")) {
      try {
        const raw = decodeURIComponent(v.slice(5));
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
          const names = arr.map((s) => String(s).trim()).filter(Boolean);
          if (names.length) {
            const keys = [...new Set(names.map((n) => questionCanonicalGroupKey(n, surveyScriptProfile)))];
            const canonicalKey =
              keys.length === 1 ? keys[0]! : questionCanonicalGroupKey(names[0]!, surveyScriptProfile);
            return { kind: "question", canonicalKey };
          }
        }
      } catch {
        return { kind: "none" };
      }
    }
    if (v.startsWith("__q__")) {
      try {
        const q = decodeURIComponent(v.slice(5)).trim();
        if (q) return { kind: "question", canonicalKey: questionCanonicalGroupKey(q, surveyScriptProfile) };
      } catch {
        return { kind: "none" };
      }
    }
    return { kind: "none" };
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {availableDates.length > 0 ? (
          <>
            <label
              htmlFor={`date-filter-${activeTab}`}
              className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
            >
              Date
            </label>
            <select
              id={`date-filter-${activeTab}`}
              value={activeDate}
              onChange={(e) => {
                const date = e.target.value;
                const url =
                  date === "" ? `${basePath}?tab=${activeTab}` : `${basePath}?tab=${activeTab}&date=${date}`;
                router.push(url);
              }}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-100 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All dates</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <button
          type="button"
          onClick={openModal}
          className="px-3 py-1.5 rounded-md border border-indigo-300 dark:border-indigo-700 text-sm font-medium text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
        >
          Update layout
        </button>
      </div>

      <div className="daily-aggregate-card w-full max-w-none rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
        <div className="daily-aggregate-card__bar flex items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="daily-aggregate-card__title font-semibold text-gray-700 dark:text-gray-100">
            Daily Aggregate
          </div>
          <div className="text-[0.6875rem] text-gray-500 dark:text-gray-400">{dateLabel}</div>
        </div>

        <div className="daily-aggregate-card__metrics border-b border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          <div>{totals.phoneBanks} Phone Banks</div>
          <div>{pberCount} PBers</div>
          <div className="sm:col-span-2 xl:col-span-1">
            {secToTime(totals.loggedInSeconds)} Time logged in{" "}
            <span className="text-gray-600 dark:text-gray-400">({hrsPerPber} hrs/pber)</span>
          </div>
          <div className="sm:col-span-2 xl:col-span-2">
            {secToTime(totals.callSeconds)} Time in calls{" "}
            <span className="text-gray-600 dark:text-gray-400">
              ({pct(totals.callSeconds, totals.loggedInSeconds)} of time logged in)
            </span>
          </div>
          <div className="sm:col-span-2 xl:col-span-3">
            {totals.callsAnswered.toLocaleString()} Calls Answered{" "}
            <span className="text-gray-600 dark:text-gray-400">
              ({formatCallsPerLoggedInHour(totals.callsAnswered, totals.loggedInSeconds)} per logged-in hr,{" "}
              {secsPerCall ? `${secsPerCall} secs/call` : "—"})
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-gray-100 dark:border-gray-700">
          <div className="lg:border-r border-gray-200 dark:border-gray-700">{renderSlot(effectiveLayout.row2Left)}</div>
          <div>{renderSlot(effectiveLayout.row2Right)}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
          <div className="lg:border-r border-gray-200 dark:border-gray-700">{renderSlot(effectiveLayout.row3Left)}</div>
          <div>{renderSlot(effectiveLayout.row3Right)}</div>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="aggregate-layout-title"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 id="aggregate-layout-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Daily Aggregate layout
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
              >
                Close
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm text-gray-800 dark:text-gray-200">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose what appears in each section below the static metrics. Settings are saved in this browser
                for <span className="font-medium text-gray-700 dark:text-gray-300">{tagId}</span> only.
              </p>
              <div className="grid grid-cols-1 gap-3">
                {SLOT_KEYS.map((key) => {
                  const slotDraft = draft[key];
                  const orphanQuestion =
                    slotDraft.kind === "question" &&
                    !questionPickerGroups.some((g) => g.canonicalKey === slotDraft.canonicalKey)
                      ? slotDraft
                      : null;
                  return (
                    <label key={key} className="block space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {SLOT_LABELS[key]}
                      </span>
                      <select
                        value={slotSelectValue(slotDraft)}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [key]: parseSlotSelectValue(e.target.value) }))
                        }
                        className="w-full mt-1 px-2 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                      >
                        <option value="__none__">Empty</option>
                        <option value="__preset:polling">Polling / Intro (preset)</option>
                        <option value="__preset:final">Final Result (preset)</option>
                        <optgroup label="Questions in this scope">
                          {questionPickerGroups.map((g) => {
                            const label =
                              g.displayLabel.length > 80 ? `${g.displayLabel.slice(0, 77)}…` : g.displayLabel;
                            const suffix = g.members.length > 1 ? ` · ${g.members.length} variants` : "";
                            return (
                              <option
                                key={g.canonicalKey}
                                value={slotSelectValue({ kind: "question", canonicalKey: g.canonicalKey })}
                              >
                                {label}
                                {suffix}
                              </option>
                            );
                          })}
                        </optgroup>
                        {orphanQuestion ? (
                          <option value={slotSelectValue(orphanQuestion)}>
                            {questionTitle(displayTitleFromCanonicalKey(orphanQuestion.canonicalKey))} (not in
                            this date&apos;s scope)
                          </option>
                        ) : null}
                      </select>
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setDraft(DEFAULT_DAILY_AGGREGATE_LAYOUT)}
                  className="px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Reset defaults
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveLayout}
                  className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
