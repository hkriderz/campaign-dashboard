"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearAllTombstonesForTag, clearTombstonesForTag } from "@/lib/tombstone-client";

export type HiddenSliceRow = {
  sliceKey: string;
  phoneBankName?: string;
  isoDate?: string;
  reason?: string;
  /** Tombstoned slice still has rows in the on-disk BQ daily-caller snapshot. */
  inBqSnapshot?: boolean;
};

/** @deprecated Import from `@/lib/tombstone-client` instead. */
export { clearTombstonesForTag } from "@/lib/tombstone-client";

/**
 * Lists campaign-days hidden via Delete / Hide (tombstone) with per-slice restore.
 */
export default function TagHiddenSlicesBar({
  tagId,
  hidden,
}: {
  tagId: string;
  hidden: HiddenSliceRow[];
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [clearAllBusy, setClearAllBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (hidden.length === 0) return null;

  async function restore(sliceKey: string) {
    setBusyKey(sliceKey);
    setErr(null);
    try {
      await clearTombstonesForTag(tagId, [sliceKey]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function clearRemovalLog() {
    const n = hidden.length;
    if (
      !confirm(
        `Clear the removal log for this candidate (${n} entr${n === 1 ? "y" : "ies"})?\n\nHidden slices will show on the dashboard again. CSV rows deleted earlier are not restored.`
      )
    ) {
      return;
    }
    setClearAllBusy(true);
    setErr(null);
    try {
      await clearAllTombstonesForTag(tagId);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setClearAllBusy(false);
    }
  }

  const labelFor = (row: HiddenSliceRow) => {
    if (row.phoneBankName && row.isoDate) return `${row.phoneBankName} (${row.isoDate})`;
    return row.sliceKey;
  };

  const anyBusy = busyKey !== null || clearAllBusy;

  return (
    <div className="mb-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50/90 dark:bg-gray-800/50 px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold">
          {hidden.length} campaign-day{hidden.length === 1 ? "" : "s"} hidden from this dashboard
        </p>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          <button
            type="button"
            disabled={anyBusy}
            className="rounded border border-gray-400 dark:border-gray-500 px-2 py-0.5 text-[11px] font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            onClick={() => void clearRemovalLog()}
          >
            {clearAllBusy ? "Clearing…" : "Clear removal log"}
          </button>
        </div>
      </div>
      <p className="text-xs mt-1 text-gray-600 dark:text-gray-400 leading-snug">
        The removal log is stored per candidate under <code className="text-[10px]">data/phonebanking-csv-tombstones-*.json</code>.
        Restore one slice, or clear the whole log to show all hidden days again. After <strong>Delete</strong>, re-import CSV
        to restore uploaded rows.
      </p>
      {err ? (
        <p className="text-xs mt-2 text-red-600 dark:text-red-400" role="alert">
          {err}
        </p>
      ) : null}
      <ul className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
        {hidden.map((row) => (
          <li
            key={row.sliceKey}
            className="flex flex-wrap items-center justify-between gap-2 text-xs border-t border-gray-200/80 dark:border-gray-700/80 pt-1.5 first:border-t-0 first:pt-0"
          >
            <span className="min-w-0">
              <span className="font-medium text-gray-900 dark:text-gray-100">{labelFor(row)}</span>
              {row.inBqSnapshot ? (
                <span className="ml-1.5 text-amber-800 dark:text-amber-300">(still in BQ snapshot)</span>
              ) : null}
              {row.reason === "delete" ? (
                <span className="ml-1.5 text-gray-500 dark:text-gray-500">CSV deleted</span>
              ) : null}
            </span>
            <button
              type="button"
              disabled={anyBusy}
              className="shrink-0 rounded border border-indigo-300 dark:border-indigo-700 px-2 py-0.5 text-[11px] font-medium text-indigo-800 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50"
              onClick={() => void restore(row.sliceKey)}
            >
              {busyKey === row.sliceKey ? "Restoring…" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
