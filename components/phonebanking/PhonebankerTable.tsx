"use client";

import type { PhonebankerDailyStat } from "@/lib/types";

type Props = {
  rows: PhonebankerDailyStat[];
  selectedDate: string | null;
};

function fmtHours(h: number) {
  if (h === 0) return "—";
  return `${h.toFixed(2)}h`;
}

export default function PhonebankerTable({ rows, selectedDate }: Props) {
  const filtered = selectedDate
    ? rows.filter((r) => r.callDate === selectedDate)
    : rows;

  if (!filtered.length) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">
        No data for this day.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-900">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
              Phonebanker
            </th>
            {!selectedDate && (
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Date</th>
            )}
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">
              Dials
            </th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">
              Call Hours
            </th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">
              Dialer Hours
            </th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Login</th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Logout</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {filtered.map((row, i) => (
            <tr key={i} className="hover:bg-indigo-50/30 dark:hover:bg-gray-800 transition-colors">
              <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                {row.phonebankerName}
              </td>
              {!selectedDate && (
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs font-mono">
                  {row.callDate}
                </td>
              )}
              <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-gray-200">
                {row.numDials.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                {fmtHours(row.totalCallHours)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                {fmtHours(row.totalDialerHours)}
              </td>
              <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                {row.earliestLogin || "—"}
              </td>
              <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                {row.latestLogout || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
