"use client";

import Link from "next/link";
import type { TextCandidateStats } from "@/lib/types";

type Props = {
  candidates: TextCandidateStats[];
};

function fmt(n: number) {
  return n.toLocaleString();
}

export default function TextCandidateGrid({ candidates }: Props) {
  if (!candidates.length) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm py-10 text-center">
        No text campaign data found. Check your BigQuery connection and campaign tags.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
      {candidates.map((c) => (
        <Link
          key={c.tag.id}
          href={`/texting/${c.tag.id}`}
          className="group block dash-card dash-card-glow p-0 overflow-hidden hover:border-teal-400/40 dark:hover:border-teal-500/40 transition-all duration-200 hover:shadow-[0_0_32px_rgba(13,148,136,0.12)]"
        >
          <div className="h-1" style={{ backgroundColor: c.tag.color }} />

          <div className="p-5 relative z-[1]">
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="min-w-0">
                <h2 className="font-bold text-lg tracking-tight text-gray-900 dark:text-gray-50 group-hover:text-teal-600 dark:group-hover:text-teal-300 transition-colors">
                  {c.tag.label}
                </h2>
                {c.tag.navGroup ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{c.tag.navGroup}</p>
                ) : null}
              </div>
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full border border-white/10"
                style={{
                  backgroundColor: `${c.tag.color}22`,
                  color: c.tag.color,
                }}
              >
                {c.campaignCount} campaign{c.campaignCount !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              {[
                { val: fmt(c.contactCount), label: "Contacts" },
                { val: fmt(c.completeCount), label: "Complete" },
                { val: fmt(c.pendingCount), label: "Pending" },
                { val: fmt(c.campaignCount), label: "Campaigns" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex min-h-[72px] flex-col items-center justify-center rounded-xl border border-gray-200/80 dark:border-white/10 bg-gray-50/80 dark:bg-white/5 px-3 py-3 text-center"
                >
                  <p className="w-full text-center text-lg sm:text-xl font-bold leading-tight tracking-tight tabular-nums text-gray-900 dark:text-gray-50">
                    {stat.val}
                  </p>
                  <p className="w-full text-center text-xs leading-snug text-gray-500 dark:text-gray-400 mt-1">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
