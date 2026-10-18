"use client";

import { useEffect, useState } from "react";
import {
  beginBusy,
  endBusy,
  ensureFetchPatched,
  subscribeBusy,
} from "@/lib/busy-indicator";

/**
 * App-wide busy cursor + corner notice while browser fetch() requests are in flight.
 * Mount once near the root (e.g. root layout).
 */
export default function BusyIndicator() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureFetchPatched();
    return subscribeBusy(setBusy);
  }, []);

  if (!busy) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex items-center gap-2 rounded-lg border border-gray-300/80 bg-gray-50/95 px-3 py-2 text-xs font-medium text-gray-700 shadow-md backdrop-blur-sm dark:border-gray-600 dark:bg-gray-900/95 dark:text-gray-200"
    >
      <svg
        className="h-3.5 w-3.5 animate-spin text-[var(--section-accent)]"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      <span>Loading data…</span>
    </div>
  );
}

/**
 * Report non-fetch work (uploads, heavy client parse) to the same busy cursor/chip.
 */
export function useReportBusy(active: boolean) {
  useEffect(() => {
    if (!active) return;
    beginBusy();
    return () => endBusy();
  }, [active]);
}
