"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  OVERVIEW_DETAIL_COLUMNS,
  type OverviewDetailColumnId,
} from "@/lib/qc-recontact/overview-detail-columns";

type ChecklistColumn<T extends string> = {
  id: T;
  label: string;
};

type ChecklistProps<T extends string> = {
  columns: readonly ChecklistColumn<T>[];
  visibleIds: readonly T[];
  onToggle: (id: T, on: boolean) => void;
  menuLabel?: string;
};

type Props = {
  visibleIds: readonly OverviewDetailColumnId[];
  onToggle: (id: OverviewDetailColumnId, on: boolean) => void;
  onDownloadCsv: () => void;
  onCopyTable: () => void;
  copyLabel?: string;
  csvDisabled?: boolean;
};

/** Show/hide checklist used by overview detail tables and the recontact table. */
export function ColumnChecklist<T extends string>({
  columns,
  visibleIds,
  onToggle,
  menuLabel = "Table columns",
}: ChecklistProps<T>) {
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
    <div className="relative" ref={rootRef}>
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
          aria-label={menuLabel}
        >
          <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
            {columns.map((col) => {
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
  );
}

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
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ColumnChecklist
        columns={OVERVIEW_DETAIL_COLUMNS}
        visibleIds={visibleIds}
        onToggle={onToggle}
        menuLabel="Detail table columns"
      />
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
