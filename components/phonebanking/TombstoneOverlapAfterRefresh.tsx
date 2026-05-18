"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PB_CHECK_TOMBSTONES_EVENT } from "@/lib/tombstone-overlap-events";

type OverlapRow = { sliceKey: string; phoneBankName?: string; isoDate?: string };

export default function TombstoneOverlapAfterRefresh({ tagId }: { tagId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OverlapRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/phonebanking/tombstone-bq-overlap?tag=${encodeURIComponent(tagId)}`);
      const json = (await res.json()) as { ok?: boolean; data?: { overlaps?: OverlapRow[] }; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Overlap check failed");
      const overlaps = json.data?.overlaps ?? [];
      if (overlaps.length === 0) return;
      setItems(overlaps);
      setSelected(new Set(overlaps.map((o) => o.sliceKey)));
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [tagId]);

  useEffect(() => {
    function onEv(e: Event) {
      const ce = e as CustomEvent<{ tagId?: string }>;
      if (ce.detail?.tagId !== tagId) return;
      void runCheck();
    }
    window.addEventListener(PB_CHECK_TOMBSTONES_EVENT, onEv);
    return () => window.removeEventListener(PB_CHECK_TOMBSTONES_EVENT, onEv);
  }, [tagId, runCheck]);

  async function clearKeys(keys: string[]) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/phonebanking/tombstone-clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: tagId, sliceKeys: keys }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Clear failed");
      setOpen(false);
      setItems([]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return err ? (
      <p className="text-xs text-red-600 dark:text-red-400 mb-2" role="alert">
        Tombstone check: {err}
      </p>
    ) : null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tombstone-overlap-title"
    >
      <div className="max-w-lg w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-xl p-5 space-y-4">
        <h2 id="tombstone-overlap-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Removed CSV slices still in BigQuery
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-snug">
          After refresh, these tombstoned campaign-days still have dialer data in snapshots. Clear tombstones to allow
          CSV re-import for those slices, or leave them blocked.
        </p>
        {err ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {err}
          </p>
        ) : null}
        <ul className="max-h-48 overflow-y-auto text-xs font-mono space-y-1 border border-gray-100 dark:border-gray-700 rounded-lg p-2">
          {items.map((it) => (
            <li key={it.sliceKey} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 rounded"
                checked={selected.has(it.sliceKey)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(it.sliceKey);
                  else next.delete(it.sliceKey);
                  setSelected(next);
                }}
              />
              <span>{it.sliceKey}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            disabled={busy}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            onClick={() => {
              setOpen(false);
              setItems([]);
              setErr(null);
            }}
          >
            None (keep tombstones)
          </button>
          <button
            type="button"
            disabled={busy}
            className="text-sm px-3 py-1.5 rounded border border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
            onClick={() => void clearKeys(items.map((i) => i.sliceKey))}
          >
            Clear all listed
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            className="text-sm px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium"
            onClick={() => void clearKeys([...selected])}
          >
            Clear selected ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
