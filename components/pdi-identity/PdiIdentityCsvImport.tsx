"use client";

import { FormEvent, useState } from "react";
import type { PdiIdentityColumnMapping, PdiIdentityRecord, PdiIdentityScanResult } from "@/lib/pdi-identity";

type ScanResponse = {
  ok: boolean;
  error?: string;
  data?: { scan: PdiIdentityScanResult; fileName: string };
};

type ImportResponse = {
  ok: boolean;
  error?: string;
  data?: {
    fileName: string;
    rowCount: number;
    savedCount: number;
    skippedNoPdiId: number;
    records: PdiIdentityRecord[];
  };
};

function ColumnSelect({
  label,
  value,
  columns,
  onChange,
  required,
}: {
  label: string;
  value: string;
  columns: string[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required ? " *" : ""}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-gray-950"
      >
        <option value="">Not mapped</option>
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PdiIdentityCsvImport({
  onImported,
  compact = false,
}: {
  onImported?: (records: PdiIdentityRecord[], summary: string) => void;
  compact?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [scan, setScan] = useState<PdiIdentityScanResult | null>(null);
  const [mapping, setMapping] = useState<PdiIdentityColumnMapping>({
    pdiIdCol: "",
    voterNameCol: "",
    voterAddressCol: "",
    noteCol: "",
  });
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function scanFile(nextFile: File | null) {
    setFile(nextFile);
    setScan(null);
    setError(null);
    setMessage(null);
    setFileName(nextFile?.name ?? "");
    if (!nextFile) return;

    setScanning(true);
    try {
      const form = new FormData();
      form.set("file", nextFile);
      const res = await fetch("/api/pdi-identity/scan", { method: "POST", body: form });
      const json = (await res.json()) as ScanResponse;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to scan CSV.");
      setScan(json.data.scan);
      setMapping(json.data.scan.suggestedMapping);
      setFileName(json.data.fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  async function importFile(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    if (!mapping.pdiIdCol) {
      setError("Map a PDI ID column before importing.");
      return;
    }

    setImporting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("pdiIdCol", mapping.pdiIdCol);
      form.set("voterNameCol", mapping.voterNameCol);
      form.set("voterAddressCol", mapping.voterAddressCol);
      form.set("noteCol", mapping.noteCol);
      const res = await fetch("/api/pdi-identity/import", { method: "POST", body: form });
      const json = (await res.json()) as ImportResponse;
      if (!json.ok || !json.data) throw new Error(json.error || "Import failed.");
      const summary = `Imported ${json.data.savedCount} identities from ${json.data.fileName}${
        json.data.skippedNoPdiId ? ` · skipped ${json.data.skippedNoPdiId} without PDI` : ""
      }.`;
      setMessage(summary);
      onImported?.(json.data.records, summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void importFile(event)}
      className={
        compact
          ? "space-y-3"
          : "space-y-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900"
      }
    >
      {!compact ? (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Import CSV</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Upload a CSV, map columns (auto-suggested), then save names and addresses by PDI ID.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {message}
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="font-medium text-gray-700 dark:text-gray-200">CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void scanFile(event.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-[var(--section-ink)] file:mr-3 file:rounded-lg file:border-0 file:bg-sky-700 file:px-3 file:py-1.5 file:text-white dark:file:bg-sky-600"
        />
        <span className="mt-1 block text-xs text-gray-500">
          {scanning
            ? "Scanning headers…"
            : scan
              ? `${scan.columns.length} columns · ~${scan.rowCountEstimate} data rows${
                  fileName ? ` · ${fileName}` : ""
                }`
              : "Upload a file to scan headers."}
        </span>
      </label>

      {scan ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ColumnSelect
              label="PDI ID"
              required
              value={mapping.pdiIdCol}
              onChange={(pdiIdCol) => setMapping((current) => ({ ...current, pdiIdCol }))}
              columns={scan.columns}
            />
            <ColumnSelect
              label="Name"
              value={mapping.voterNameCol}
              onChange={(voterNameCol) => setMapping((current) => ({ ...current, voterNameCol }))}
              columns={scan.columns}
            />
            <ColumnSelect
              label="Address"
              value={mapping.voterAddressCol}
              onChange={(voterAddressCol) =>
                setMapping((current) => ({ ...current, voterAddressCol }))
              }
              columns={scan.columns}
            />
            <ColumnSelect
              label="Note"
              value={mapping.noteCol}
              onChange={(noteCol) => setMapping((current) => ({ ...current, noteCol }))}
              columns={scan.columns}
            />
          </div>

          {Object.keys(scan.firstRow).length ? (
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-white/5">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2" colSpan={2}>
                      First-row preview
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[mapping.pdiIdCol, mapping.voterNameCol, mapping.voterAddressCol, mapping.noteCol]
                    .filter(Boolean)
                    .map((column) => (
                      <tr key={column} className="border-t border-gray-100 dark:border-white/5">
                        <td className="px-3 py-1.5 font-medium text-gray-600 dark:text-gray-300">
                          {column}
                        </td>
                        <td className="px-3 py-1.5 text-gray-800 dark:text-gray-100">
                          {scan.firstRow[column] || "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={importing || !mapping.pdiIdCol}
            className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            {importing ? "Importing…" : "Import identities"}
          </button>
        </>
      ) : null}
    </form>
  );
}
