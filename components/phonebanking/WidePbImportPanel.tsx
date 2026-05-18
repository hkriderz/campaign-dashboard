"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { applyWideColumnOrderToCsvText } from "@/lib/wide-csv-column-order";
import type { WidePbPrepareResult } from "@/lib/wide-csv-prepare";

type SliceRow = {
  sliceKey: string;
  rowCount: number;
  phoneBankName: string;
  isoDate: string;
};

const FOCUS_OPTIONS = [
  { id: "general", label: "General" },
  { id: "gotv", label: "GOTV" },
  { id: "violation", label: "Violation" },
] as const;

export type WidePbImportPanelProps = {
  tagId: string;
  tagLabel: string;
  slices: SliceRow[];
  meta: WidePbPrepareResult;
  wideCsv: string;
  onImportComplete?: () => void;
  /** Prefix for downloaded CSV filename (default `pb-report`). */
  downloadPrefix?: string;
  resetOrderLabel?: string;
  orderHelpText?: string;
  showTagLink?: boolean;
};

export default function WidePbImportPanel({
  tagId,
  tagLabel,
  slices,
  meta,
  wideCsv,
  onImportComplete,
  downloadPrefix = "pb-report",
  resetOrderLabel = "Reset to file order",
  orderHelpText,
  showTagLink = true,
}: WidePbImportPanelProps) {
  const [columnOrder, setColumnOrder] = useState<string[]>(
    () => meta.sourceColumnOrder ?? meta.columns ?? []
  );
  const [phoneBankName, setPhoneBankName] = useState("");
  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceSliceKey, setReplaceSliceKey] = useState("");
  const [focus, setFocus] = useState<(typeof FOCUS_OPTIONS)[number]["id"]>("general");
  const [overrideDate, setOverrideDate] = useState(false);
  const [targetIsoDate, setTargetIsoDate] = useState("");
  const [ackTombstone, setAckTombstone] = useState(false);
  const [pendingTombstoneKeys, setPendingTombstoneKeys] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err" | "warn">("ok");
  const [importDatesSelected, setImportDatesSelected] = useState<Set<string>>(
    () => new Set(meta.datesIso)
  );
  const [draggingFromIndex, setDraggingFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragFromRef = useRef<number | null>(null);

  useEffect(() => {
    setColumnOrder(meta.sourceColumnOrder ?? meta.columns ?? []);
    setImportDatesSelected(new Set(meta.datesIso));
    if (meta.datesIso.length === 1) {
      setTargetIsoDate(meta.datesIso[0]!);
      setOverrideDate(false);
    } else if (meta.datesIso.length > 1) {
      setTargetIsoDate(meta.datesIso[0] ?? "");
      setOverrideDate(false);
    } else {
      setOverrideDate(true);
      setTargetIsoDate("");
    }
  }, [meta]);

  const columnKindByHeader = useMemo(() => {
    const m = new Map<string, { role: string; detail: string }>();
    const key = (h: string) => h.trim();
    for (const row of meta.matchPreview.mappedToSheet) {
      m.set(key(row.header), {
        role: "Dashboard rollup",
        detail: `${row.sheetField ?? ""} · ${row.category}`,
      });
    }
    for (const row of meta.matchPreview.extraColumns) {
      const k = key(row.header);
      if (!m.has(k)) {
        m.set(k, {
          role: row.matched ? "Script (seen on reference PB)" : "Script column",
          detail: row.category,
        });
      }
    }
    return m;
  }, [meta.matchPreview]);

  function describeFixedHeader(header: string): { role: string; detail: string } | null {
    const h = header.trim();
    if (h === "Caller Name") return { role: "Lead", detail: "Per-caller key" };
    if (h === "Date") return { role: "Lead", detail: "Calendar day" };
    if (h === "Hours logged in") return { role: "Time", detail: "Roster column (zeros if absent)" };
    if (h === "Time in calls") return { role: "Time", detail: "Roster column (zeros if absent)" };
    return null;
  }

  function moveColumn(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= columnOrder.length) return;
    setColumnOrder((prev) => {
      const next = [...prev];
      const tmp = next[index]!;
      next[index] = next[j]!;
      next[j] = tmp;
      return next;
    });
  }

  function moveColumnToPosition(fromIndex: number, oneBasedPosition: number) {
    setColumnOrder((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      const target = Math.min(prev.length, Math.max(1, Math.floor(oneBasedPosition)));
      if (target === fromIndex + 1) return prev;
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(target - 1, 0, item!);
      return next;
    });
  }

  function reorderColumnByDrag(fromIndex: number, toIndex: number) {
    setColumnOrder((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
        return prev;
      }
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
      next.splice(insertAt, 0, item!);
      return next;
    });
  }

  function clearColumnDragState() {
    dragFromRef.current = null;
    setDraggingFromIndex(null);
    setDragOverIndex(null);
  }

  function handleColumnDragStart(index: number, e: DragEvent) {
    dragFromRef.current = index;
    setDraggingFromIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    if (e.dataTransfer.setDragImage && e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 16, 16);
    }
  }

  function handleColumnDragOver(index: number, e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragFromRef.current !== index) {
      setDragOverIndex(index);
    }
  }

  function handleColumnDrop(index: number, e: DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const from = dragFromRef.current ?? (raw !== "" ? parseInt(raw, 10) : NaN);
    if (Number.isFinite(from)) {
      reorderColumnByDrag(from, index);
    }
    clearColumnDragState();
  }

  function resetColumnOrder() {
    setColumnOrder(meta.sourceColumnOrder ?? meta.columns ?? []);
  }

  const importDatesSorted = useMemo(() => {
    if (!meta.datesIso.length) return [];
    return meta.datesIso.filter((d) => importDatesSelected.has(d));
  }, [meta.datesIso, importDatesSelected]);

  useEffect(() => {
    if (!meta.datesIso.length) return;
    if (importDatesSorted.length >= 1) {
      setTargetIsoDate(importDatesSorted[0]!);
    } else {
      setTargetIsoDate(meta.datesIso[0] ?? "");
    }
  }, [meta, importDatesSorted]);

  useEffect(() => {
    if (importDatesSorted.length > 1 && overrideDate) {
      setOverrideDate(false);
    }
  }, [importDatesSorted.length, overrideDate]);

  function downloadWideCsv() {
    const text =
      columnOrder.length > 0 ? applyWideColumnOrderToCsvText(wideCsv, columnOrder) : wideCsv;
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${downloadPrefix}-${tagId}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function postStwImport(fd: FormData) {
    return fetch("/api/phonebanking/stw-import", { method: "POST", body: fd });
  }

  async function onImport() {
    if (!tagId || !wideCsv?.trim()) {
      setMessageTone("err");
      setMessage("No wide report data to import.");
      return;
    }
    const pb = phoneBankName.trim();
    if (!pb) {
      setMessageTone("err");
      setMessage("Enter the phone bank name to use on the dashboard (matches BigQuery naming when possible).");
      return;
    }
    if (replaceMode && !replaceSliceKey) {
      setMessageTone("err");
      setMessage("Select a phone bank slice to replace.");
      return;
    }
    if (replaceMode && importDatesSorted.length !== 1) {
      setMessageTone("err");
      setMessage("Replace mode: select exactly one calendar day above.");
      return;
    }
    if (!replaceMode && overrideDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetIsoDate.trim())) {
      setMessageTone("err");
      setMessage("Enter a valid target date (YYYY-MM-DD) or turn off date override.");
      return;
    }
    if (meta.datesIso.length > 0 && importDatesSorted.length === 0) {
      setMessageTone("err");
      setMessage("Select at least one calendar day to import.");
      return;
    }

    setImporting(true);
    setMessage("");
    try {
      const datesMetaCount = meta.datesIso.length;
      const ack = ackTombstone || pendingTombstoneKeys.length > 0;

      const finishSuccess = (summary: string) => {
        setMessageTone("ok");
        setMessage(summary);
        setPendingTombstoneKeys([]);
        setAckTombstone(false);
        onImportComplete?.();
      };

      const appendCommon = (fd: FormData) => {
        fd.append("tag", tagId);
        fd.append("phoneBankName", pb);
        fd.append("wideCsv", wideCsv);
        if (columnOrder.length > 0) {
          fd.append("wideColumnOrder", JSON.stringify(columnOrder));
        }
        if (ack) fd.append("acknowledgeTombstone", "1");
        if (datesMetaCount > 0) {
          fd.append("includedIsoDates", JSON.stringify(importDatesSorted));
        }
      };

      if (replaceMode) {
        const fd = new FormData();
        appendCommon(fd);
        fd.append("mode", "replace");
        fd.append("focus", focus);
        if (replaceSliceKey) fd.append("replaceSliceKey", replaceSliceKey);
        const res = await postStwImport(fd);
        const json = await res.json();
        if (res.status === 409 && json.code === "TOMBSTONE_CONFLICT") {
          setMessageTone("warn");
          setMessage(json.error ?? "Tombstone conflict");
          setPendingTombstoneKeys(Array.isArray(json.sliceKeys) ? json.sliceKeys : []);
          return;
        }
        if (!json.ok) {
          setMessageTone("err");
          setMessage(json.error ?? "Import failed");
          return;
        }
        const d = json.data;
        const bumps = d.bumpedSlices?.length
          ? ` Renamed ${d.bumpedSlices.length} slice(s) to avoid overwriting existing data.`
          : "";
        const rep = d.replacedSlices?.length ? ` Replaced ${d.replacedSlices.length} slice(s).` : "";
        finishSuccess(
          `Imported ${d.importedRows ?? 0} caller row(s). Store now has ${d.rowCount ?? 0} rows, ${d.sliceCount ?? 0} slice(s).${rep}${bumps}`
        );
        return;
      }

      if (importDatesSorted.length > 1) {
        let totalImported = 0;
        let lastRowCount = 0;
        let lastSliceCount = 0;
        let bumpTotal = 0;
        let repTotal = 0;
        for (const iso of importDatesSorted) {
          const fd = new FormData();
          appendCommon(fd);
          fd.append("mode", "add");
          fd.append("focus", focus);
          fd.append("includedIsoDates", JSON.stringify([iso]));
          const res = await postStwImport(fd);
          const json = await res.json();
          if (res.status === 409 && json.code === "TOMBSTONE_CONFLICT") {
            setMessageTone("warn");
            setMessage(`Stopped at ${iso}: ${json.error ?? "Tombstone conflict"}`);
            setPendingTombstoneKeys(Array.isArray(json.sliceKeys) ? json.sliceKeys : []);
            return;
          }
          if (!json.ok) {
            setMessageTone("err");
            setMessage(`Import failed for ${iso}: ${json.error ?? "Unknown error"}`);
            return;
          }
          const d = json.data;
          totalImported += d.importedRows ?? 0;
          lastRowCount = d.rowCount ?? lastRowCount;
          lastSliceCount = d.sliceCount ?? lastSliceCount;
          bumpTotal += d.bumpedSlices?.length ?? 0;
          repTotal += d.replacedSlices?.length ?? 0;
        }
        const bumps = bumpTotal ? ` Renamed ${bumpTotal} slice bump(s) total.` : "";
        const rep = repTotal ? ` Replaced ${repTotal} slice(s) total.` : "";
        finishSuccess(
          `Imported ${importDatesSorted.length} calendar day(s) (${totalImported} caller row(s)) with the same phone bank name. Store now has ${lastRowCount} rows, ${lastSliceCount} slice(s).${rep}${bumps}`
        );
        return;
      }

      const fd = new FormData();
      appendCommon(fd);
      fd.append("mode", "add");
      fd.append("focus", focus);
      if (overrideDate && targetIsoDate.trim()) {
        fd.append("targetIsoDate", targetIsoDate.trim());
      }

      const res = await postStwImport(fd);
      const json = await res.json();
      if (res.status === 409 && json.code === "TOMBSTONE_CONFLICT") {
        setMessageTone("warn");
        setMessage(json.error ?? "Tombstone conflict");
        setPendingTombstoneKeys(Array.isArray(json.sliceKeys) ? json.sliceKeys : []);
        return;
      }
      if (!json.ok) {
        setMessageTone("err");
        setMessage(json.error ?? "Import failed");
        return;
      }
      const d = json.data;
      const bumps = d.bumpedSlices?.length
        ? ` Renamed ${d.bumpedSlices.length} slice(s) to avoid overwriting existing data.`
        : "";
      const rep = d.replacedSlices?.length ? ` Replaced ${d.replacedSlices.length} slice(s).` : "";
      finishSuccess(
        `Imported ${d.importedRows ?? 0} caller row(s). Store now has ${d.rowCount ?? 0} rows, ${d.sliceCount ?? 0} slice(s).${rep}${bumps}`
      );
    } catch (e) {
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const defaultOrderHelp =
    orderHelpText ??
    "Default order: Caller, Date, time columns, script questions in file order (01, 02, …), then Canvass Result columns last. Drag ⋮⋮, type a position, or use ↑ ↓. Import saves this order for the Data tab pivot.";

  const focusRadioName = `wide-pb-focus-${tagId}`;

  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 p-4 space-y-4 text-sm">
      {showTagLink ? (
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Merges into{" "}
          <Link href={`/phonebanking/${tagId}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
            {tagLabel}
          </Link>
          . Reorder columns and choose calendar days before import.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <p className="text-xs text-gray-700 dark:text-gray-300">
          <strong>{meta.rowCount}</strong> wide row(s) · days:{" "}
          {meta.datesIso.length ? meta.datesIso.join(", ") : "—"}
        </p>
        <button
          type="button"
          onClick={downloadWideCsv}
          className="dash-action-btn dash-action-btn-sm dash-action-btn-download font-semibold"
        >
          Download wide CSV
        </button>
      </div>

      {meta.datesIso.length > 0 ? (
        <fieldset className="rounded-lg border border-violet-200/80 dark:border-violet-800/80 bg-white/40 dark:bg-gray-900/20 p-3 space-y-2">
          <legend className="text-xs font-semibold text-gray-800 dark:text-gray-200 px-1">
            Calendar days to import
          </legend>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-snug">
            Only checked days are merged into the CSV store. Download wide CSV always includes every day in the file.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {meta.datesIso.map((iso) => (
              <label key={iso} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-violet-400 dark:border-violet-600"
                  checked={importDatesSelected.has(iso)}
                  onChange={() => {
                    setImportDatesSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(iso)) next.delete(iso);
                      else next.add(iso);
                      return next;
                    });
                  }}
                />
                <span className="font-mono text-[11px]">
                  {iso}
                  {meta.dateRowCounts?.[iso] != null ? ` · ${meta.dateRowCounts[iso]} wide row(s)` : null}
                </span>
              </label>
            ))}
          </div>
          {meta.datesIso.length > 1 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setImportDatesSelected(new Set(meta.datesIso))}
                className="text-[11px] font-semibold text-violet-800 dark:text-violet-200 hover:underline"
              >
                Select all days
              </button>
              <button
                type="button"
                onClick={() => setImportDatesSelected(new Set())}
                className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 hover:underline"
              >
                Clear all
              </button>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-gray-800 dark:text-gray-200">Column order (import &amp; download)</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetColumnOrder}
              className="rounded border border-violet-300 dark:border-violet-700 px-2 py-1 text-[11px] font-semibold text-violet-800 dark:text-violet-200 hover:bg-violet-100/60 dark:hover:bg-violet-900/40"
            >
              {resetOrderLabel}
            </button>
            <button
              type="button"
              onClick={() => setColumnOrder(meta.defaultColumnOrder ?? meta.columns ?? [])}
              className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800/60"
              title="Groups columns by dashboard rollup fields (not raw file layout)"
            >
              Dashboard field order
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-600 dark:text-gray-400">{defaultOrderHelp}</p>
        <div className="overflow-x-auto max-h-[min(28rem,55vh)] overflow-y-auto rounded border border-violet-200/80 dark:border-violet-900/50">
          <table className="min-w-full border-collapse text-left">
            <thead className="sticky top-0 bg-violet-100/90 dark:bg-violet-950/80 text-[10px] uppercase tracking-wide text-gray-600 dark:text-gray-300">
              <tr>
                <th className="p-1.5 border-b border-violet-200 dark:border-violet-800 w-8" aria-label="Drag" />
                <th className="p-1.5 border-b border-violet-200 dark:border-violet-800 w-14">Pos</th>
                <th className="p-1.5 border-b border-violet-200 dark:border-violet-800">Column</th>
                <th className="p-1.5 border-b border-violet-200 dark:border-violet-800">Role</th>
                <th className="p-1.5 border-b border-violet-200 dark:border-violet-800">Detail</th>
                <th className="p-1.5 border-b border-violet-200 dark:border-violet-800 w-24">Reorder</th>
              </tr>
            </thead>
            <tbody className="text-gray-800 dark:text-gray-200">
              {columnOrder.map((header, i) => {
                const fixed = describeFixedHeader(header);
                const mapped = columnKindByHeader.get(header.trim());
                let role = fixed?.role ?? mapped?.role ?? "—";
                let detail = fixed?.detail ?? mapped?.detail ?? "—";
                if (mapped?.detail?.match(/^(callsAnswered|correctPerson|surveyed)\b/)) {
                  role = "Contact metrics";
                }
                const isDragging = draggingFromIndex === i;
                const isDropTarget = dragOverIndex === i && draggingFromIndex !== i;
                return (
                  <tr
                    key={`${header}-${i}`}
                    onDragOver={(e) => handleColumnDragOver(i, e)}
                    onDrop={(e) => handleColumnDrop(i, e)}
                    className={[
                      "border-b border-violet-100/80 dark:border-violet-900/40 align-top transition-colors",
                      isDragging ? "opacity-40" : "",
                      isDropTarget
                        ? "bg-violet-200/70 dark:bg-violet-900/50 ring-1 ring-inset ring-violet-400 dark:ring-violet-600"
                        : "",
                    ].join(" ")}
                  >
                    <td className="p-1.5 w-8">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => handleColumnDragStart(i, e)}
                        onDragEnd={clearColumnDragState}
                        className="cursor-grab touch-none rounded px-1 py-0.5 text-gray-500 hover:bg-violet-100/80 hover:text-gray-800 active:cursor-grabbing dark:hover:bg-violet-900/60 dark:hover:text-gray-200"
                        aria-label={`Drag to reorder ${header}`}
                        title="Drag to reorder"
                      >
                        ⋮⋮
                      </button>
                    </td>
                    <td className="p-1.5">
                      <input
                        type="number"
                        min={1}
                        max={columnOrder.length}
                        defaultValue={i + 1}
                        key={`${header}-pos-${i}`}
                        onBlur={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (Number.isFinite(n)) moveColumnToPosition(i, n);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        className="w-12 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-1 py-0.5 text-[11px] tabular-nums"
                        aria-label={`Position for ${header}`}
                      />
                    </td>
                    <td className="p-1.5 font-mono text-[10px] whitespace-pre-wrap break-words max-w-[14rem]">
                      {header}
                    </td>
                    <td className="p-1.5 text-[11px]">{role}</td>
                    <td className="p-1.5 text-[10px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words max-w-[18rem]">
                      {detail}
                    </td>
                    <td className="p-1.5">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={() => moveColumn(i, -1)}
                          className="rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-40 hover:bg-white/80 dark:hover:bg-gray-800"
                          aria-label="Move column up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={i >= columnOrder.length - 1}
                          onClick={() => moveColumn(i, 1)}
                          className="rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-40 hover:bg-white/80 dark:hover:bg-gray-800"
                          aria-label="Move column down"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Phone bank name (stored with each row)
        <input
          type="text"
          value={phoneBankName}
          onChange={(e) => setPhoneBankName(e.target.value)}
          className="mt-1 block w-full max-w-md rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
          placeholder="e.g. Tuesday 5–8pm GOTV"
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-gray-700 dark:text-gray-300">Focus (add mode)</legend>
        {FOCUS_OPTIONS.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name={focusRadioName}
              checked={focus === o.id}
              onChange={() => setFocus(o.id)}
              disabled={replaceMode}
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={overrideDate}
          onChange={(e) => setOverrideDate(e.target.checked)}
          disabled={replaceMode || importDatesSorted.length > 1}
        />
        Override date (all rows use this ISO day)
      </label>
      <input
        type="date"
        value={targetIsoDate}
        onChange={(e) => setTargetIsoDate(e.target.value)}
        disabled={replaceMode || importDatesSorted.length > 1 || !overrideDate}
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-sm"
      />

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={replaceMode} onChange={(e) => setReplaceMode(e.target.checked)} />
        Replace an existing saved phone bank slice
      </label>

      {replaceMode ? (
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Slice to replace
          <select
            value={replaceSliceKey}
            onChange={(e) => setReplaceSliceKey(e.target.value)}
            className="mt-1 block w-full max-w-lg rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
          >
            <option value="">— Select —</option>
            {slices.map((s) => (
              <option key={s.sliceKey} value={s.sliceKey}>
                {s.phoneBankName} · {s.isoDate} ({s.rowCount} rows)
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {pendingTombstoneKeys.length > 0 ? (
        <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 p-2 text-xs space-y-2">
          <p className="font-semibold text-amber-900 dark:text-amber-200">Previously removed from CSV</p>
          <p className="text-amber-900/90">Keys: {pendingTombstoneKeys.join(", ")}</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ackTombstone} onChange={(e) => setAckTombstone(e.target.checked)} />
            Clear removal record and import
          </label>
        </div>
      ) : null}

      <button
        type="button"
        disabled={
          importing ||
          !wideCsv ||
          (pendingTombstoneKeys.length > 0 && !ackTombstone) ||
          !phoneBankName.trim()
        }
        onClick={() => void onImport()}
        className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold"
      >
        {importing ? "Importing…" : replaceMode ? "Replace slice" : "Import to CSV store"}
      </button>

      {message ? (
        <p
          className={
            messageTone === "err"
              ? "text-sm text-red-700 dark:text-red-400"
              : messageTone === "warn"
                ? "text-sm text-amber-800 dark:text-amber-200"
                : "text-sm text-emerald-700 dark:text-emerald-400"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}