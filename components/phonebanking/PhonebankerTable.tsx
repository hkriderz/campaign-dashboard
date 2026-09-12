"use client";

import { useState } from "react";
import { secToTime } from "@/lib/csv-parser";
import type { PhonebankerDailyStat } from "@/lib/types";
import SynthesizedCountLabel from "./SynthesizedCountLabel";
import SynthesizedCallsModal, { type SynthesizedCallsScope } from "./SynthesizedCallsModal";

type Props = {
  rows: PhonebankerDailyStat[];
  selectedDate: string | null;
  tagId?: string;
  campaignId?: string;
};

function hoursCell(seconds: number): string {
  return secToTime(Math.max(0, seconds));
}

export default function PhonebankerTable({ rows, selectedDate, tagId, campaignId }: Props) {
  const showDate = selectedDate === null;
  const [synthScope, setSynthScope] = useState<SynthesizedCallsScope | null>(null);

  if (!rows.length) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">
        No data for this selection.
      </p>
    );
  }

  const totalDialerSeconds = rows.reduce((s, r) => s + r.totalDialerSeconds, 0);
  const totalCallSeconds = rows.reduce((s, r) => s + r.totalCallSeconds, 0);
  const totalSurveyed = rows.reduce((s, r) => s + r.surveyed, 0);
  const totalStrongSupport = rows.reduce((s, r) => s + r.strongSupport, 0);
  const totalSynthesized = rows.reduce((s, r) => s + (r.strongSupportSynthesized ?? 0), 0);

  const openSynth = (synthesized: number, phonebanker?: string, callDate?: string) => {
    if (!tagId || synthesized <= 0) return;
    setSynthScope({
      tagId,
      campaignId,
      callDate: callDate ?? selectedDate ?? undefined,
      phonebanker,
      family: "strongSupport",
      title: `${synthesized.toLocaleString()} synthesized Strong support calls`,
    });
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                Phonebanker
              </th>
              {showDate && (
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Date</th>
              )}
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">
                Hrs on dialer
              </th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">
                Hrs on calls
              </th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">
                Surveyed
              </th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">
                Strong Supports
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            <tr className="bg-gray-50 dark:bg-gray-800 border-b-2 border-gray-200 dark:border-gray-600 font-semibold">
              <td className="px-4 py-3 text-gray-900 dark:text-gray-100">TOTAL</td>
              {showDate && <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">—</td>}
              <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-gray-200">
                {hoursCell(totalDialerSeconds)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-gray-200">
                {hoursCell(totalCallSeconds)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-gray-200">
                {totalSurveyed.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-300">
                <SynthesizedCountLabel
                  total={totalStrongSupport}
                  synthesized={totalSynthesized}
                  onOpen={
                    totalSynthesized > 0 && tagId
                      ? () => openSynth(totalSynthesized)
                      : undefined
                  }
                />
              </td>
            </tr>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-indigo-50/30 dark:hover:bg-gray-800 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                  {row.phonebankerName}
                </td>
                {showDate && (
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs font-mono">
                    {row.callDate}
                  </td>
                )}
                <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                  {hoursCell(row.totalDialerSeconds)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                  {hoursCell(row.totalCallSeconds)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-gray-200">
                  {row.surveyed.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-300 font-semibold">
                  <SynthesizedCountLabel
                    total={row.strongSupport}
                    synthesized={row.strongSupportSynthesized ?? 0}
                    onOpen={
                      (row.strongSupportSynthesized ?? 0) > 0 && tagId
                        ? () =>
                            openSynth(
                              row.strongSupportSynthesized ?? 0,
                              row.phonebankerName,
                              row.callDate
                            )
                        : undefined
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SynthesizedCallsModal scope={synthScope} onClose={() => setSynthScope(null)} />
    </>
  );
}
