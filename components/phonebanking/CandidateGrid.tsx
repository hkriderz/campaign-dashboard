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
      <p className="text-gray-500 dark:text-gray-400 text-sm py-10 text-center">
        No campaign data found. Check your BigQuery connection and campaign tags.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
      {candidates.map((c) => (
        <Link
          key={c.tag.id}
          href={`/phonebanking/${c.tag.id}`}
          className="group block dash-card dash-card-glow p-0 overflow-hidden hover:border-indigo-400/40 dark:hover:border-indigo-500/40 transition-all duration-200 hover:shadow-[0_0_32px_rgba(124,108,240,0.12)]"
        >
          <div
            className="h-1"
            style={{ backgroundColor: c.tag.color }}
          />

          <div className="p-5 relative z-[1]">
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="min-w-0">
                <h2 className="font-bold text-lg tracking-tight text-gray-900 dark:text-gray-50 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                  {c.tag.label}
                </h2>
                {c.tag.navGroup ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {c.tag.navGroup}
                  </p>
                ) : null}
              </div>
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full border border-white/10"
                style={{
                  backgroundColor: c.tag.color + "22",
                  color: c.tag.color,
                }}
              >
                {c.phoneBankCount} phone bank{c.phoneBankCount !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { val: fmt(c.totalDials), label: "Dials" },
                { val: fmtHours(c.totalHours), label: "Call Time" },
                { val: fmt(c.uniqueCallers), label: "Callers" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-gray-200/80 dark:border-white/10 bg-gray-50/80 dark:bg-white/5 p-3"
                >
                  <p className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                    {stat.val}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>

            {c.firstCallDate && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 text-right">
                {c.firstCallDate} → {c.lastCallDate ?? "present"}
              </p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
