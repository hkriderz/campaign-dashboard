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
      <p className="text-[var(--section-muted)] text-sm py-10 text-center">
        No text campaign data found. Check your BigQuery connection and campaign tags.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--section-rule)] border-y border-[var(--section-rule)]">
      {candidates.map((c) => (
        <li key={c.tag.id}>
          <Link
            href={`/texting/${c.tag.id}`}
            className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 py-4 px-1 hover:bg-[color-mix(in_srgb,var(--section-accent)_6%,transparent)] transition-colors"
          >
            <div
              className="hidden sm:block w-1 self-stretch flex-shrink-0"
              style={{ backgroundColor: c.tag.color }}
              aria-hidden
            />
            <div className="min-w-0 sm:w-48 flex-shrink-0">
              <h2 className="font-display text-xl font-semibold text-[var(--section-ink)] group-hover:underline underline-offset-4">
                {c.tag.label}
              </h2>
              {c.tag.navGroup ? (
                <p className="section-kicker mt-1">{c.tag.navGroup}</p>
              ) : null}
            </div>
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-1 border w-fit"
              style={{
                backgroundColor: `${c.tag.color}22`,
                color: c.tag.color,
                borderColor: `${c.tag.color}44`,
              }}
            >
              {c.campaignCount} campaign{c.campaignCount !== 1 ? "s" : ""}
            </span>
            <dl className="grid grid-cols-3 gap-4 sm:ml-auto text-sm">
              {[
                { val: fmt(c.contactCount), label: "Contacts" },
                { val: fmt(c.completeCount), label: "Complete" },
                { val: fmt(c.pendingCount), label: "Pending" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-[10px] uppercase tracking-[0.12em] text-[var(--section-muted)]">
                    {stat.label}
                  </dt>
                  <dd className="font-display text-lg font-semibold tabular-nums text-[var(--section-ink)]">
                    {stat.val}
                  </dd>
                </div>
              ))}
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}
