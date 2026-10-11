"use client";

import { useEffect, useState } from "react";

const JSON_SCAN_WARNING_BYTES = 2.2 * 1024 ** 3;

type BqCostJob = {
  at: string;
  label: string;
  bytesBilled: number;
  estimatedUsd: number;
};

type BqMonthCost = {
  month: string;
  totalBytesBilled: number;
  totalEstimatedUsd: number;
  budgetUsd: number | null;
  usdPerTib: number;
  jobs: BqCostJob[];
};

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function formatGib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toLocaleString("en-US", { maximumFractionDigits: 2 })} GiB`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function BqSpendMeter() {
  const [cost, setCost] = useState<BqMonthCost | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/bigquery/cost", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as BqMonthCost | { error?: string } | null;
        if (!res.ok || !data || !("month" in data)) {
          throw new Error(data && "error" in data && data.error ? data.error : res.statusText);
        }
        if (!cancelled) setCost(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const budget = cost?.budgetUsd ?? null;
  const spent = cost?.totalEstimatedUsd ?? 0;
  const ratio = budget && budget > 0 ? spent / budget : 0;
  const barColor =
    budget == null ? "bg-indigo-500" : ratio >= 1 ? "bg-red-600" : ratio >= 0.8 ? "bg-amber-500" : "bg-indigo-500";
  const width = budget && budget > 0 ? Math.min(100, ratio * 100) : 100;

  return (
    <section className="mt-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40 px-3 py-3">
      <h2 className="font-display text-sm font-semibold text-[var(--section-ink)]">BigQuery spend this month</h2>
      {error ? <p className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p> : null}
      {!cost && !error ? <p className="mt-2 text-xs text-gray-500">Loading spend…</p> : null}
      {cost ? (
        <>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {cost.month} list price at ${cost.usdPerTib.toFixed(2)} / TiB, before the free terabyte.{" "}
            <span className="font-medium text-gray-800 dark:text-gray-200">{formatUsd(spent)}</span>
            {budget == null ? " so far." : ` of ${formatUsd(budget)}.`}
          </p>
          {budget == null ? (
            <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">
              Set <code>BQ_MONTHLY_BUDGET_USD</code> to draw this against a monthly budget.
            </p>
          ) : null}
          <div className="mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden" aria-hidden="true">
            <div className={`h-full ${barColor}`} style={{ width: `${budget == null ? 100 : width}%` }} />
          </div>
          <ul className="mt-3 space-y-1">
            {cost.jobs.length === 0 ? (
              <li className="text-[11px] text-gray-500">No BigQuery jobs logged this month.</li>
            ) : (
              cost.jobs.map((job, index) => (
                <li key={`${job.at}-${index}`} className="text-[11px] text-gray-600 dark:text-gray-400">
                  <span className="text-gray-800 dark:text-gray-200">{formatWhen(job.at)}</span>
                  {" · "}
                  {job.label}
                  {" · "}
                  {formatGib(job.bytesBilled)}
                  {" · "}
                  {formatUsd(job.estimatedUsd)}
                  {job.bytesBilled >= JSON_SCAN_WARNING_BYTES ? (
                    <span className="ml-2 text-amber-800 dark:text-amber-300">
                      Large scan — about the size of a full contact or callee JSON read.
                    </span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </>
      ) : null}
    </section>
  );
}
