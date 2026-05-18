"use client";

import Link from "next/link";
import type { PhoneBankSummary } from "@/lib/types";

const DEFAULT_NEUTRAL_DOT = "#64748b";

type Props = {
  phoneBanks: PhoneBankSummary[];
  /** When omitted, detail links go to `/phonebanking/c/[campaignId]` (all-campaigns flow). */
  tagId?: string;
  tagColor?: string;
  emptyMessage?: string;
};

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtHours(h: number) {
  if (h === 0) return "—";
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(h * 60)}m`;
}

export default function PhoneBankTable({
  phoneBanks,
  tagId,
  tagColor = DEFAULT_NEUTRAL_DOT,
  emptyMessage,
}: Props) {
  if (!phoneBanks.length) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm py-10 text-center">
        {emptyMessage ??
          (tagId
            ? "No phone banks found for this candidate."
            : "No phone banks matched the active lifecycle filter for this list.")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Campaign Name</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Dials</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Call Time</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Callers</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Date Range</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-center">
              Details
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {phoneBanks.map((pb) => (
            <tr
              key={pb.campaignId}
              className="hover:bg-indigo-50/40 dark:hover:bg-gray-800 transition-colors"
            >
              <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-xs">
                <span className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tagColor }}
                  />
                  {pb.campaignName}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-gray-200">
                {fmt(pb.totalDials)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-gray-200">
                {fmtHours(pb.totalHours)}
              </td>
              <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                {pb.uniqueCallers}
              </td>
              <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                {pb.firstCallDate
                  ? `${pb.firstCallDate} → ${pb.lastCallDate ?? "present"}`
                  : "—"}
              </td>
              <td className="px-4 py-3 text-center">
                {pb.campaignId ? (
                  <Link
                    href={
                      tagId
                        ? `/phonebanking/${tagId}/${pb.campaignId}`
                        : `/phonebanking/c/${pb.campaignId}`
                    }
                    className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-200 font-medium text-xs px-3 py-1.5 rounded-md border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    View →
                  </Link>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
