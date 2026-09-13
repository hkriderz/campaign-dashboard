"use client";

import Link from "next/link";
import type { CandidateStats } from "@/lib/types";

type Props = {
  candidates: CandidateStats[];
};

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtHours(h: number) {
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(h * 60)}m`;
}

export default function CandidateGrid({ candidates }: Props) {
  if (!candidates.length) {
    return (
      <p className="text-[var(--section-muted)] text-sm py-10 text-center">
        No campaign data found. Check your BigQuery connection and campaign tags.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {candidates.map((c) => (
        <Link
          key={c.tag.id}
          href={`/phonebanking/${c.tag.id}`}
          className="group block dash-card p-0 overflow-hidden hover:border-[var(--section-accent)] transition-colors"
        >
          <div className="flex">
            <div
              className="w-1 flex-shrink-0"
              style={{ backgroundColor: c.tag.color }}
              aria-hidden
            />

            <div className="p-5 min-w-0 flex-1">
              <div className="flex items-start justify-between mb-4 gap-2">
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold tracking-tight text-[var(--section-ink)] group-hover:underline underline-offset-4">
                    {c.tag.label}
                  </h2>
                  {c.tag.navGroup ? (
                    <p className="section-kicker mt-1">
                      {c.tag.navGroup}
                    </p>
                  ) : null}
                </div>
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-1 border"
                  style={{
                    backgroundColor: c.tag.color + "22",
                    color: c.tag.color,
                    borderColor: c.tag.color + "44",
                  }}
                >
                  {c.phoneBankCount} phone bank{c.phoneBankCount !== 1 ? "s" : ""}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-[var(--section-rule)] pt-3">
                {[
                  { val: fmt(c.totalCalls), label: "Total Calls" },
                  { val: fmt(c.totalSurveyed), label: "Surveyed" },
                  { val: fmtHours(c.totalHours), label: "Call Time" },
                  { val: fmt(c.uniqueCallers), label: "Callers" },
                ].map((stat) => (
                  <div key={stat.label} className="min-h-0">
                    <dt className="text-[10px] uppercase tracking-[0.12em] text-[var(--section-muted)]">
                      {stat.label}
                    </dt>
                    <dd className="font-display text-lg font-semibold tabular-nums text-[var(--section-ink)]">
                      {stat.val}
                    </dd>
                  </div>
                ))}
              </dl>

              {c.firstCallDate && (
                <p className="text-xs text-[var(--section-muted)] mt-3 text-right">
                  {c.firstCallDate} → {c.lastCallDate ?? "present"}
                </p>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
