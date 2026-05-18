"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import WidePbImportPanel from "@/components/phonebanking/WidePbImportPanel";
import type { WidePbPrepareResult } from "@/lib/wide-csv-prepare";

type SliceRow = {
  sliceKey: string;
  rowCount: number;
  phoneBankName: string;
  isoDate: string;
};

type ConvertResponse = {
  ok: boolean;
  data?: WidePbPrepareResult;
  error?: string;
};

type Props = {
  tagId: string;
  tagLabel: string;
  slices: SliceRow[];
  onMetaRefresh?: () => void;
};

export default function StwRawUploadPanel({
  tagId,
  tagLabel,
  slices,
  onMetaRefresh,
}: Props) {
  const rawFileInputRef = useRef<HTMLInputElement>(null);
  const [timezone, setTimezone] = useState("US/Pacific");
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [convertLoading, setConvertLoading] = useState(false);
  const [wideCsv, setWideCsv] = useState<string | null>(null);
  const [convertMeta, setConvertMeta] = useState<WidePbPrepareResult | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err" | "warn">("ok");

  const onConvert = useCallback(async () => {
    if (!rawFile) {
      setMessageTone("err");
      setMessage("Choose a raw Scale-to-Win export (.csv).");
      return;
    }
    setConvertLoading(true);
    setMessage("");
    setWideCsv(null);
    setConvertMeta(null);
    try {
      const fd = new FormData();
      fd.append("file", rawFile);
      fd.append("timezone", timezone);
      fd.append("tag", tagId);
      const res = await fetch("/api/phonebanking/stw-convert", { method: "POST", body: fd });
      const json = (await res.json()) as ConvertResponse;
      if (!json.ok || !json.data) {
        setMessageTone("err");
        setMessage(json.error ?? "Conversion failed");
        return;
      }
      setWideCsv(json.data.wideCsv);
      setConvertMeta(json.data);
      setMessageTone("ok");
      setMessage(
        `Converted to wide PB report: ${json.data.rowCount} row(s), ${json.data.columns.length} column(s). Download or import below.`
      );
    } catch (e) {
      setMessageTone("err");
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setConvertLoading(false);
    }
  }, [rawFile, timezone, tagId]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600 dark:text-gray-400">
        Upload the <strong>raw</strong> Scale-to-Win CSV (one row per call with UTC timestamp). The server builds a
        wide per-caller PB crosstab (Pacific calendar day by default), orders columns like roster exports (times, call
        metrics, then script questions), and merges into the same CSV store as{" "}
        <Link href={`/phonebanking/${tagId}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
          {tagLabel}
        </Link>
        . Reorder columns below before import if needed.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          IANA timezone (calendar day for crosstab)
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
            placeholder="US/Pacific"
          />
        </label>
        <div>
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Raw STW export (.csv)
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={rawFileInputRef}
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(e) => setRawFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => rawFileInputRef.current?.click()}
              className="rounded-lg border border-violet-300 dark:border-violet-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-semibold text-violet-900 dark:text-violet-200 shadow-sm hover:bg-violet-50 dark:hover:bg-violet-950/40 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900"
            >
              Browse…
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
              {rawFile ? rawFile.name : "No file chosen"}
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={convertLoading || !rawFile}
        onClick={() => void onConvert()}
        className="rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold"
      >
        {convertLoading ? "Converting…" : "Convert to PB report"}
      </button>

      {convertMeta && wideCsv ? (
        <WidePbImportPanel
          key={`${tagId}-${convertMeta.rowCount}-${convertMeta.columns.length}`}
          tagId={tagId}
          tagLabel={tagLabel}
          slices={slices}
          meta={convertMeta}
          wideCsv={wideCsv}
          downloadPrefix="stw-pb-report"
          resetOrderLabel="Reset to STW order"
          orderHelpText="Default order matches the raw STW export: Caller, Date, time columns (zeros), script questions left-to-right (01, 02, …), then Canvass Result columns last. Drag ⋮⋮, type a position, or use ↑ ↓. Import saves this order for the Data tab pivot."
          showTagLink={false}
          onImportComplete={onMetaRefresh}
        />
      ) : null}

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
