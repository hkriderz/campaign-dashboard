"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  OVERVIEW_DETAIL_COLUMNS,
  type OverviewDetailColumnId,
} from "@/lib/qc-recontact/overview-detail-columns";

type Props = {
  visibleIds: readonly OverviewDetailColumnId[];
  onToggle: (id: OverviewDetailColumnId, on: boolean) => void;
  onDownloadCsv: () => void;
  onCopyTable: () => void;
  copyLabel?: string;
  csvDisabled?: boolean;
};

/**
 * Columns checklist + Download CSV + Copy table for overview detail dropdowns.
 */
export default function OverviewDetailColumnControls({
  visibleIds,
  onToggle,
  onDownloadCsv,
  onCopyTable,
  copyLabel = "Copy table",
  csvDisabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visible = new Set(visibleIds);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2" ref={rootRef}>
      <div className="relative">
        <button
          type="button"
          className={chipClass(open)}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          Columns
        </button>
        {open ? (
          <div
            id={menuId}
            className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-[var(--section-rule)] bg-white p-2 shadow-lg dark:bg-gray-900"
            role="group"
            aria-label="Detail table columns"
          >
            <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
              {OVERVIEW_DETAIL_COLUMNS.map((col) => {
                const checked = visible.has(col.id);
                const onlyOne = visibleIds.length === 1 && checked;
                return (
                  <li key={col.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={onlyOne}
                        onChange={(e) => onToggle(col.id, e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span>{col.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      <button type="button" className={chipClass(false)} disabled={csvDisabled} onClick={onDownloadCsv}>
        Download CSV
      </button>
      <button type="button" className={chipClass(false)} disabled={csvDisabled} onClick={onCopyTable}>
        {copyLabel}
      </button>
    </div>
  );
}

function chipClass(active: boolean): string {
  return [
    "border px-2.5 py-1 text-xs font-medium disabled:opacity-50",
    active
      ? "border-[var(--section-accent)] bg-[color-mix(in_srgb,var(--section-accent)_12%,transparent)] text-[var(--section-ink)]"
      : "border-[var(--section-rule)] bg-transparent text-[var(--section-muted)] hover:border-[var(--section-accent)]",
  ].join(" ");
}
