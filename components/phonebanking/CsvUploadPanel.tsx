"use client";

import { useRef, useState } from "react";

type Props = {
  tagId: string;
  uploadedAt: string | null;
  missingSliceCount?: number;
  missingSliceExamples?: string[];
  /** Shown when no upload timestamp yet (per-candidate wording). */
  sheetUploadHint?: string;
  onSuccess?: (rowCount: number) => void;
};

const DEFAULT_SHEET_HINT =
  "Upload your Google Sheets phone bank export (CSV) to merge spreadsheet slices with BigQuery.";

export default function CsvUploadPanel({
  tagId,
  uploadedAt,
  missingSliceCount = 0,
  missingSliceExamples = [],
  sheetUploadHint = DEFAULT_SHEET_HINT,
  onSuccess,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) {
      setStatus("error");
      setMessage("Please upload a .csv file.");
      return;
    }

    setStatus("uploading");
    setMessage(`Parsing ${file.name}…`);

    const form = new FormData();
    form.append("tag", tagId);
    form.append("file", file);

    try {
      const res = await fetch("/api/phonebanking/upload", {
        method: "POST",
        body: form,
      });
      const json = await res.json();

      if (json.ok) {
        setStatus("success");
        setMessage(
          `Merged ${json.data.uploadedSliceCount} slice(s): +${json.data.insertedSliceCount} new, ${json.data.replacedSliceCount} replaced.`
        );
        onSuccess?.(json.data.rowCount);
        // Reload to reflect new data
        setTimeout(() => window.location.reload(), 800);
      } else {
        setStatus("error");
        setMessage(json.error ?? "Upload failed.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="font-semibold text-indigo-800 dark:text-indigo-300 text-sm mb-0.5">
            Google Sheets CSV
          </p>
          {uploadedAt ? (
            <p className="text-xs text-indigo-600 dark:text-indigo-400">
              Last uploaded: {uploadedAt}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">{sheetUploadHint}</p>
          )}
          {missingSliceCount > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
              Missing campaign-day slices from CSV: {missingSliceCount}
            </p>
          )}
          {missingSliceExamples.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Examples: {missingSliceExamples.join(", ")}
            </p>
          )}
        </div>

        <button
          onClick={() => inputRef.current?.click()}
          disabled={status === "uploading"}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {status === "uploading" ? "Uploading…" : uploadedAt ? "Re-upload CSV" : "Upload CSV"}
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        className={[
          "mt-3 border-2 border-dashed rounded-lg p-4 text-center text-xs transition-colors cursor-pointer",
          dragOver
            ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300"
            : "border-indigo-200 dark:border-indigo-700 text-indigo-400 dark:text-indigo-400 hover:border-indigo-400",
        ].join(" ")}
        onClick={() => inputRef.current?.click()}
      >
        Drag & drop or click to select CSV
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {message && (
        <p
          className={[
            "mt-2 text-xs font-medium",
            status === "error"
              ? "text-red-600 dark:text-red-400"
              : status === "success"
                ? "text-green-600 dark:text-green-400"
                : "text-indigo-500 dark:text-indigo-400",
          ].join(" ")}
        >
          {message}
        </p>
      )}
    </div>
  );
}
