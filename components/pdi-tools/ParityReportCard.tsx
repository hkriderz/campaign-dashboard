"use client";

import type { ParityReport } from "@/lib/pdi-tools/sync/parity";

type Props = {
  report: ParityReport | null;
  loading: boolean;
  onRun: () => void;
};

export default function ParityReportCard({ report, loading, onRun }: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-indigo-300 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-200">Engine parity check</h3>
          <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80 mt-1 max-w-xl">
            Runs the same dry-run window in TypeScript and Python and compares row counts. Use before your first live
            post.
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className="text-xs font-semibold px-3 py-2 rounded-lg border border-indigo-400 dark:border-indigo-600 text-indigo-800 dark:text-indigo-200 bg-white dark:bg-gray-900 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 disabled:opacity-50"
        >
          {loading ? "Comparing…" : "Compare counts"}
        </button>
      </div>

      {report ? (
        <div className="space-y-3">
          <p
            className={`text-sm font-semibold ${report.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
          >
            {report.ok ? "✓ All compared counts match" : "⚠ Mismatch or Python error — review before live sync"}
          </p>
          {report.pythonError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{report.pythonError}</p>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-indigo-200/60 dark:border-indigo-900/60 bg-white dark:bg-gray-900">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-left text-gray-500">
                  <th className="px-3 py-2 font-semibold">Metric</th>
                  <th className="px-3 py-2 font-semibold">TypeScript</th>
                  <th className="px-3 py-2 font-semibold">Python</th>
                  <th className="px-3 py-2 font-semibold">Match</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.field} className="border-b border-gray-50 dark:border-gray-800/80 last:border-0">
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.label}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{row.typescript}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{row.python ?? "—"}</td>
                    <td className="px-3 py-2">
                      {row.match ? (
                        <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">≠</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
