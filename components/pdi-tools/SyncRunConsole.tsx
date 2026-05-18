"use client";

import { useMemo } from "react";
import type { SyncLogEvent } from "@/lib/pdi-tools/sync/logger";
import { SYNC_PHASE_STEPS, phaseFromMessage, progressForPhase, type SyncPhase } from "@/lib/pdi-tools/sync/phases";
import type { SyncRunSummary } from "@/lib/pdi-tools/sync/types";

type RunStatus = "idle" | "running" | "completed" | "failed";

type Props = {
  events: SyncLogEvent[];
  summary: SyncRunSummary | null;
  status: RunStatus;
  dryRun: boolean;
};

function levelStyles(level: SyncLogEvent["level"]): string {
  switch (level) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-300";
    case "debug":
      return "text-gray-500";
    default:
      return "text-gray-200";
  }
}

function levelBadge(level: SyncLogEvent["level"]): string {
  switch (level) {
    case "error":
      return "bg-red-500/20 text-red-300 border-red-500/30";
    case "warn":
      return "bg-amber-500/20 text-amber-200 border-amber-500/30";
    case "debug":
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    default:
      return "bg-emerald-500/20 text-emerald-200 border-emerald-500/30";
  }
}

function statusBadge(status: RunStatus, dryRun: boolean): { label: string; className: string } {
  if (status === "running") {
    return {
      label: dryRun ? "Dry run in progress" : "Sync in progress",
      className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 animate-pulse",
    };
  }
  if (status === "failed") {
    return {
      label: "Failed",
      className: "bg-red-500/15 text-red-300 border-red-500/40",
    };
  }
  if (status === "completed") {
    return {
      label: dryRun ? "Dry run complete" : "Sync complete",
      className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    };
  }
  return {
    label: "Ready",
    className: "bg-gray-500/15 text-gray-400 border-gray-600",
  };
}

function deriveProgress(events: SyncLogEvent[], status: RunStatus): { progress: number; phase: SyncPhase } {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.progress !== undefined) {
      return {
        progress: e.progress,
        phase: e.phase ?? phaseFromMessage(e.message) ?? "starting",
      };
    }
    const fromMsg = phaseFromMessage(e.message);
    if (fromMsg) {
      return { progress: progressForPhase(fromMsg), phase: fromMsg };
    }
  }
  if (status === "completed" || status === "failed") {
    return { progress: 100, phase: "complete" };
  }
  return { progress: status === "running" ? 8 : 0, phase: "starting" };
}

export default function SyncRunConsole({ events, summary, status, dryRun }: Props) {
  const { progress, phase } = useMemo(() => deriveProgress(events, status), [events, status]);
  const badge = statusBadge(status, dryRun);

  const visibleEvents = useMemo(
    () => events.filter((e) => e.level !== "debug" || e.message.includes("=")),
    [events]
  );

  if (status === "idle" && events.length === 0 && !summary) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-emerald-50/80 to-white dark:from-emerald-950/40 dark:to-gray-900 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 tracking-tight">Sync console</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            TypeScript engine · live pipeline progress
          </p>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            <span>
              Step:{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {SYNC_PHASE_STEPS.find((s) => s.id === phase)?.label ?? "—"}
              </span>
            </span>
            <span className="font-mono tabular-nums">{progress}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SYNC_PHASE_STEPS.filter((s) => s.id !== "starting").map((step) => {
            const stepProgress = step.progress;
            const active = phase === step.id;
            const done = progress >= stepProgress;
            return (
              <span
                key={step.id}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                  active
                    ? "bg-emerald-600 text-white border-emerald-500"
                    : done
                      ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                      : "bg-gray-50 dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-700"
                }`}
              >
                {step.label}
              </span>
            );
          })}
        </div>

        {summary ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {[
              { label: "From BQ", value: summary.rowsFromBq },
              { label: "Payload", value: summary.payloadCount },
              { label: "Skipped", value: summary.rowsSkipped },
              { label: "Deduped", value: summary.rowsDeduped },
              { label: "Same-batch dupes", value: summary.rowsDedupedSameBatch },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/50 px-3 py-2.5 text-center"
              >
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                  {stat.label}
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{stat.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-950 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            <span className="ml-2 text-[10px] font-mono text-gray-500">sync.log</span>
          </div>
          <div className="max-h-80 overflow-y-auto p-3 space-y-1.5 font-mono text-xs">
            {visibleEvents.length === 0 ? (
              <p className="text-gray-500 animate-pulse">Waiting for log events…</p>
            ) : (
              visibleEvents.map((e, i) => (
                <div key={`${e.ts}-${i}`} className="flex gap-2 leading-relaxed">
                  <span className="text-gray-600 shrink-0 tabular-nums">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                  <span
                    className={`shrink-0 text-[9px] font-bold uppercase px-1 py-0.5 rounded border ${levelBadge(e.level)}`}
                  >
                    {e.level}
                  </span>
                  <span className={`${levelStyles(e.level)} break-words`}>{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
