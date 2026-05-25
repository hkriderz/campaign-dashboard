"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DISTRICT_COLUMN_MAPPING,
  DISTRICT_LAYER_OPTIONS,
  type DistrictClassifierJob,
  type DistrictJobStatus,
  type DistrictLayerId,
  type DistrictReviewRow,
  type DistrictScanResult,
  type DistrictTargetSelection,
} from "@/lib/district-classifier/types";

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

const DISTRICT_RANGES: Record<DistrictLayerId, { label: string; values: string[] }> = {
  "la-city-council": {
    label: "City Council District",
    values: Array.from({ length: 15 }, (_, i) => `cd${i + 1}`),
  },
  "ca-state-assembly": {
    label: "Assembly District",
    values: Array.from({ length: 80 }, (_, i) => `ad${i + 1}`),
  },
};

const FUTURE_MENUS = [
  "Congressional District",
  "State Senate District",
  "County Supervisor District",
];

const statusStyles: Record<DistrictJobStatus, string> = {
  queued: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-white/5 dark:text-gray-300 dark:border-white/10",
  processing: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-800",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",
  failed: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not started";
}

function selectedValues(select: HTMLSelectElement | null): string[] {
  if (!select) return [];
  return Array.from(select.selectedOptions).map((option) => option.value);
}

export default function DistrictClassifierClient() {
  const [jobs, setJobs] = useState<DistrictClassifierJob[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<DistrictScanResult | null>(null);
  const [reviewRows, setReviewRows] = useState<Record<string, DistrictReviewRow[]>>({});

  const [layers, setLayers] = useState<Set<DistrictLayerId>>(() => new Set(["la-city-council"]));
  const [targetSelection, setTargetSelection] = useState<DistrictTargetSelection>({});
  const [addressCol, setAddressCol] = useState(DEFAULT_DISTRICT_COLUMN_MAPPING.addressCol);
  const [cityCol, setCityCol] = useState(DEFAULT_DISTRICT_COLUMN_MAPPING.cityCol);
  const [stateCol, setStateCol] = useState(DEFAULT_DISTRICT_COLUMN_MAPPING.stateCol);
  const [zipCol, setZipCol] = useState(DEFAULT_DISTRICT_COLUMN_MAPPING.zipCol);
  const [streetNumCol, setStreetNumCol] = useState(DEFAULT_DISTRICT_COLUMN_MAPPING.streetNumCol);
  const [streetNameCol, setStreetNameCol] = useState(DEFAULT_DISTRICT_COLUMN_MAPPING.streetNameCol);
  const [aptCol, setAptCol] = useState(DEFAULT_DISTRICT_COLUMN_MAPPING.aptCol);

  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const hasRunningJob = useMemo(
    () => jobs.some((job) => job.status === "queued" || job.status === "processing"),
    [jobs]
  );

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/district-classifier/jobs", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<{ jobs: DistrictClassifierJob[] }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to load jobs.");
      setJobs(json.data.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = window.setInterval(() => void loadJobs(), 2500);
    return () => window.clearInterval(timer);
  }, [hasRunningJob, loadJobs]);

  async function scanFile(nextFile: File | null) {
    setFile(nextFile);
    setScan(null);
    setMessage("");
    setError("");
    if (!nextFile) return;

    setScanning(true);
    try {
      const form = new FormData();
      form.set("file", nextFile);
      const res = await fetch("/api/district-classifier/scan", { method: "POST", body: form });
      const json = (await res.json()) as ApiResponse<{ scan: DistrictScanResult }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to scan CSV.");
      setScan(json.data.scan);
      setAddressCol(json.data.scan.suggestedMapping.address || DEFAULT_DISTRICT_COLUMN_MAPPING.addressCol);
      setCityCol(json.data.scan.suggestedMapping.city || DEFAULT_DISTRICT_COLUMN_MAPPING.cityCol);
      setStateCol(json.data.scan.suggestedMapping.state || DEFAULT_DISTRICT_COLUMN_MAPPING.stateCol);
      setZipCol(json.data.scan.suggestedMapping.zip || DEFAULT_DISTRICT_COLUMN_MAPPING.zipCol);
      setStreetNumCol(json.data.scan.suggestedMapping.street_number || DEFAULT_DISTRICT_COLUMN_MAPPING.streetNumCol);
      setStreetNameCol(json.data.scan.suggestedMapping.street_name || DEFAULT_DISTRICT_COLUMN_MAPPING.streetNameCol);
      setAptCol(json.data.scan.suggestedMapping.apartment || DEFAULT_DISTRICT_COLUMN_MAPPING.aptCol);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  function toggleLayer(layerId: DistrictLayerId) {
    setLayers((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next.size ? next : current;
    });
  }

  async function startProcessing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("layers", [...layers].join(","));
      form.set("targetSelection", JSON.stringify(targetSelection));
      form.set("addressCol", addressCol);
      form.set("cityCol", cityCol);
      form.set("stateCol", stateCol);
      form.set("zipCol", zipCol);
      form.set("streetNumCol", streetNumCol);
      form.set("streetNameCol", streetNameCol);
      form.set("aptCol", aptCol);

      const res = await fetch("/api/district-classifier/jobs", { method: "POST", body: form });
      const json = (await res.json()) as ApiResponse<{ job: DistrictClassifierJob }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to start processing.");
      setJobs((current) => [json.data!.job, ...current]);
      setMessage("Processing started. Progress will update automatically.");
      void loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function loadReview(jobId: string) {
    const res = await fetch(`/api/district-classifier/jobs/${encodeURIComponent(jobId)}/review`, {
      cache: "no-store",
    });
    const json = (await res.json()) as ApiResponse<{ rows: DistrictReviewRow[] }>;
    if (json.ok && json.data) {
      setReviewRows((current) => ({ ...current, [jobId]: json.data!.rows }));
    }
  }

  async function cancelJob(jobId: string) {
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/district-classifier/jobs/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const json = (await res.json()) as ApiResponse<{ job: DistrictClassifierJob }>;
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to cancel job.");
      setJobs((current) => current.map((job) => (job.id === jobId ? json.data!.job : job)));
      setMessage("Job cancelled. You can start a new classifier job now.");
      void loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-500 dark:text-indigo-300 mb-3">
          District Classifier
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
          CSV district classification
        </h1>
        <p className="mt-3 text-gray-600 dark:text-gray-400 max-w-3xl">
          Upload a CSV, map its columns, select target districts, and run the lightweight Python
          district engine. Progress is polled from the Next.js app, with outputs written as CSV files.
        </p>
      </section>

      <form onSubmit={startProcessing} className="dash-card space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-5">
          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void scanFile(event.target.files?.[0] ?? null)}
              className="dash-input mt-1 block w-full text-sm p-3"
            />
            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-2">
              {scanning ? "Scanning headers..." : scan ? `${scan.columns.length} columns detected.` : "Upload a file to scan headers."}
            </span>
          </label>

          <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-4">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Processing model</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Next.js saves the upload, starts Python with `child_process`, then polls job status.
            </p>
          </div>
        </div>

        {scan ? (
          <>
            <section>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">Column Mapping</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <ColumnSelect label="Street address" value={addressCol} onChange={setAddressCol} columns={scan.columns} />
                <ColumnSelect label="City" value={cityCol} onChange={setCityCol} columns={scan.columns} />
                <ColumnSelect label="State" value={stateCol} onChange={setStateCol} columns={scan.columns} />
                <ColumnSelect label="ZIP" value={zipCol} onChange={setZipCol} columns={scan.columns} />
                <ColumnSelect label="Street number" value={streetNumCol} onChange={setStreetNumCol} columns={scan.columns} />
                <ColumnSelect label="Street name" value={streetNameCol} onChange={setStreetNameCol} columns={scan.columns} />
                <ColumnSelect label="Apartment/unit" value={aptCol} onChange={setAptCol} columns={scan.columns} />
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">District Selection</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {DISTRICT_LAYER_OPTIONS.map((layer) => (
                  <div key={layer.id} className="rounded-xl border border-gray-200 dark:border-white/10 bg-white/70 dark:bg-white/5 p-4">
                    <label className="flex gap-3">
                      <input
                        type="checkbox"
                        checked={layers.has(layer.id)}
                        onChange={() => toggleLayer(layer.id)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{layer.label}</span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{layer.description}</span>
                      </span>
                    </label>
                    <label className="block mt-4">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        Target {DISTRICT_RANGES[layer.id].label}s
                      </span>
                      <select
                        multiple
                        disabled={!layers.has(layer.id)}
                        value={targetSelection[layer.id] ?? []}
                        onChange={(event) => {
                          const values = selectedValues(event.currentTarget);
                          setTargetSelection((current) => ({
                            ...current,
                            [layer.id]: values,
                          }));
                        }}
                        className="dash-input mt-1 block w-full p-2 text-sm min-h-32 disabled:opacity-50"
                      >
                        {DISTRICT_RANGES[layer.id].values.map((district) => (
                          <option key={district} value={district}>
                            {district.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}

                {FUTURE_MENUS.map((label) => (
                  <div key={label} className="rounded-xl border border-dashed border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-4 opacity-75">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Menu reserved for the next district layer. Add GeoJSON and a layer config to enable it.
                    </p>
                    <select disabled className="dash-input mt-3 block w-full p-2 text-sm">
                      <option>Coming soon</option>
                    </select>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {message ? <Notice tone="ok" message={message} /> : null}
        {error ? <Notice tone="err" message={error} /> : null}
        {hasRunningJob ? (
          <Notice
            tone="warn"
            message="A classifier job is queued or running. Cancel stale jobs from the Jobs list before starting another upload."
          />
        ) : null}

        <button
          type="submit"
          disabled={uploading || !file || !scan || hasRunningJob}
          className="dash-btn-primary px-5 py-2.5 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {uploading ? "Starting..." : "Start processing"}
        </button>
      </form>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Jobs</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Progress polls while a job is running.</p>
          </div>
          <button type="button" onClick={() => void loadJobs()} className="dash-action-btn dash-action-btn-md dash-action-btn-copy">
            Refresh
          </button>
        </div>

        {loadingJobs ? (
          <div className="dash-card text-sm text-gray-500 dark:text-gray-400">Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="dash-card text-sm text-gray-500 dark:text-gray-400">No district classification jobs yet.</div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                reviewRows={reviewRows[job.id] ?? []}
                onLoadReview={() => void loadReview(job.id)}
                onCancel={() => void cancelJob(job.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  columns,
  onChange,
}: {
  label: string;
  value: string;
  columns: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="dash-input mt-1 block w-full p-3 text-sm">
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

function Notice({ tone, message }: { tone: "ok" | "err" | "warn"; message: string }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"
      : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300";
  return <div className={`rounded-xl border p-4 text-sm ${cls}`}>{message}</div>;
}

function JobCard({
  job,
  reviewRows,
  onLoadReview,
  onCancel,
}: {
  job: DistrictClassifierJob;
  reviewRows: DistrictReviewRow[];
  onLoadReview: () => void;
  onCancel: () => void;
}) {
  const progress = typeof job.progress === "number" ? job.progress : 0;
  const processedRows = typeof job.processedRows === "number" ? job.processedRows : 0;
  const totalRows = typeof job.totalRows === "number" ? job.totalRows : null;
  const canCancel = job.status === "queued" || job.status === "processing";

  return (
    <article className="dash-card space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{job.originalFileName}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Created {formatDate(job.createdAt)} · Started {formatDate(job.startedAt)}
          </p>
        </div>
        <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[job.status]}`}>
          {job.status}
        </span>
      </div>

      <div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>{job.progressMessage}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
          <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {processedRows.toLocaleString()} of {totalRows?.toLocaleString() ?? "unknown"} rows
        </p>
      </div>

      {job.errorMessage ? <Notice tone="err" message={job.errorMessage} /> : null}

      {canCancel ? (
        <div>
          <button type="button" onClick={onCancel} className="dash-action-btn dash-action-btn-md dash-action-btn-hide">
            Cancel stuck job
          </button>
        </div>
      ) : null}

      {job.exports.length ? (
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Downloads</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {job.exports.map((file) => (
              <a
                key={file.fileName}
                href={file.downloadUrl}
                className="rounded-lg border border-gray-200 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-2 text-sm text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
              >
                <span className="font-medium">{file.fileName}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {file.rowCount ?? "Unknown"} rows · {file.kind.replace("_", " ")}
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {job.exports.some((file) => file.kind === "manual_review") ? (
        <div>
          <button type="button" onClick={onLoadReview} className="dash-action-btn dash-action-btn-md dash-action-btn-copy">
            Load review queue
          </button>
          {reviewRows.length ? <ReviewTable rows={reviewRows} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function ReviewTable({ rows }: { rows: DistrictReviewRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-gray-400">
          <tr>
            <th className="text-left p-3 font-medium">Row</th>
            <th className="text-left p-3 font-medium">Name</th>
            <th className="text-left p-3 font-medium">Address</th>
            <th className="text-left p-3 font-medium">Confidence</th>
            <th className="text-left p-3 font-medium">Method</th>
            <th className="text-left p-3 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-white/10">
          {rows.map((row) => (
            <tr key={row.rowNumber}>
              <td className="p-3">{row.rowNumber}</td>
              <td className="p-3">{row.name || "-"}</td>
              <td className="p-3">{row.address || "-"}</td>
              <td className="p-3">{row.confidence || "-"}</td>
              <td className="p-3">{row.method || "-"}</td>
              <td className="p-3">{row.reason || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
