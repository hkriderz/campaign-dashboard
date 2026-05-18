"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ParityReportCard from "@/components/pdi-tools/ParityReportCard";
import SyncRunConsole from "@/components/pdi-tools/SyncRunConsole";
import type { SyncLogEvent } from "@/lib/pdi-tools/sync/logger";
import type { ParityReport } from "@/lib/pdi-tools/sync/parity";
import type { SyncRunSummary } from "@/lib/pdi-tools/sync/types";

type MappingFileEntry = {
  id: string;
  fileName: string;
  source: "mappings";
  absolutePath: string;
  modifiedAt: string;
  sizeBytes: number;
};

type MappingFilesResponse = {
  mappingsDir: string;
  exportsDir?: string;
  workingDir: string;
  uploadsDir: string;
  files: MappingFileEntry[];
  error?: string;
};

type PythonSyncResponse = {
  engine?: "python";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  mappingFile?: string | null;
  error?: string;
  code?: number;
};

type TypescriptStartResponse = {
  engine: "typescript";
  runId: string;
  streamUrl: string;
  error?: string;
  code?: number;
};

type SyncDoneEvent = {
  type: "done";
  status: "completed" | "failed";
  summary: SyncRunSummary | null;
  error: string | null;
};

function formatSource(_source: MappingFileEntry["source"]): string {
  return "pdi-mappings";
}

type RunStatus = "idle" | "running" | "completed" | "failed";

export default function SyncerClient() {
  const [mode, setMode] = useState<"incremental" | "range">("incremental");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [minRecords, setMinRecords] = useState(50);
  const [rollbackRun, setRollbackRun] = useState("");
  const [mappingFileId, setMappingFileId] = useState<string>("auto");
  const [mappingCatalog, setMappingCatalog] = useState<MappingFilesResponse | null>(null);
  const [mappingLoadError, setMappingLoadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pythonResult, setPythonResult] = useState<PythonSyncResponse | null>(null);
  const [logEvents, setLogEvents] = useState<SyncLogEvent[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [tsSummary, setTsSummary] = useState<SyncRunSummary | null>(null);
  const [parityReport, setParityReport] = useState<ParityReport | null>(null);
  const [parityLoading, setParityLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const refreshMappingFiles = useCallback(async () => {
    setMappingLoadError(null);
    try {
      const res = await fetch("/api/pdi/mapping-files");
      const data = (await res.json()) as MappingFilesResponse;
      if (!res.ok) {
        setMappingLoadError(data.error ?? res.statusText);
        return;
      }
      setMappingCatalog(data);
    } catch (e) {
      setMappingLoadError(e instanceof Error ? e.message : "Failed to list mapping files");
    }
  }, []);

  useEffect(() => {
    void refreshMappingFiles();
  }, [refreshMappingFiles]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  async function handleMappingUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadBusy(true);
    setUploadMessage(null);
    try {
      const fd = new FormData();
      fd.append("mappingFile", file);
      const res = await fetch("/api/pdi/mapping-files", { method: "POST", body: fd });
      const data = (await res.json()) as MappingFilesResponse & {
        ok?: boolean;
        saved?: MappingFileEntry;
        error?: string;
      };
      if (!res.ok) {
        setUploadMessage(data.error ?? "Upload failed");
        return;
      }
      setMappingCatalog(data);
      if (data.saved?.id) {
        setMappingFileId(data.saved.id);
      }
      setUploadMessage(`Uploaded ${data.saved?.fileName ?? file.name}`);
    } catch (err) {
      setUploadMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadBusy(false);
    }
  }

  function appendLog(event: SyncLogEvent) {
    setLogEvents((prev) => [...prev, event]);
  }

  async function runParityCheck() {
    setParityLoading(true);
    setParityReport(null);
    setClientError(null);
    try {
      const res = await fetch("/api/pdi/sync-parity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          start: start.trim() || undefined,
          end: end.trim() || undefined,
          mappingFileId,
        }),
      });
      const data = (await res.json()) as ParityReport & { error?: string };
      if (!res.ok) {
        setClientError(data.error ?? res.statusText);
        return;
      }
      setParityReport(data);
    } catch (e) {
      setClientError(e instanceof Error ? e.message : "Parity check failed");
    } finally {
      setParityLoading(false);
    }
  }

  async function runSync() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    setLoading(true);
    setRunStatus("running");
    setClientError(null);
    setPythonResult(null);
    setLogEvents([]);
    setTsSummary(null);

    try {
      const res = await fetch("/api/pdi/sync-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          start: start.trim() || undefined,
          end: end.trim() || undefined,
          dryRun,
          minRecords,
          rollbackRun: rollbackRun.trim() || undefined,
          mappingFileId,
        }),
      });

      const data = (await res.json()) as TypescriptStartResponse | PythonSyncResponse;

      if (!res.ok) {
        setClientError("error" in data && data.error ? data.error : res.statusText);
        setRunStatus("failed");
        setLoading(false);
        return;
      }

      if (data.engine === "typescript" && "streamUrl" in data) {
        const es = new EventSource(data.streamUrl);
        eventSourceRef.current = es;

        es.onmessage = (msg) => {
          let parsed: SyncLogEvent | SyncDoneEvent;
          try {
            parsed = JSON.parse(msg.data) as SyncLogEvent | SyncDoneEvent;
          } catch {
            return;
          }

          if ("type" in parsed && parsed.type === "done") {
            setLoading(false);
            setRunStatus(parsed.status === "failed" ? "failed" : "completed");
            setTsSummary(parsed.summary);
            if (parsed.error) {
              setClientError(parsed.error);
            }
            es.close();
            eventSourceRef.current = null;
            return;
          }

          appendLog(parsed as SyncLogEvent);
        };

        es.onerror = () => {
          if (es.readyState === EventSource.CLOSED) return;
          setClientError("Lost connection to sync log stream.");
          setRunStatus("failed");
          setLoading(false);
          es.close();
          eventSourceRef.current = null;
        };
        return;
      }

      setPythonResult(data as PythonSyncResponse);
      setRunStatus((data as PythonSyncResponse).exitCode === 0 ? "completed" : "failed");
      setLoading(false);
    } catch (e) {
      setClientError(e instanceof Error ? e.message : "Request failed");
      setRunStatus("failed");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">PDI Syncer</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Native TypeScript sync with live logs (default). Set{" "}
          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">PDI_SYNC_ENGINE=python</code> to use{" "}
          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">stw_to_pdi.py</code> instead.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-5">
        <div className="space-y-3 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-semibold text-gray-800 dark:text-gray-200">Mapping file</label>
            <button
              type="button"
              onClick={() => void refreshMappingFiles()}
              className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Refresh list
            </button>
          </div>

          {mappingCatalog ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
              Folder: {mappingCatalog.mappingsDir ?? mappingCatalog.workingDir}
            </p>
          ) : null}
          {mappingLoadError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{mappingLoadError}</p>
          ) : null}

          <select
            value={mappingFileId}
            onChange={(e) => setMappingFileId(e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="auto">Auto — newest in pdi-mappings</option>
            {(mappingCatalog?.files ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.fileName} ({formatSource(f.source)}, {new Date(f.modifiedAt).toLocaleString()})
              </option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
              {uploadBusy ? "Uploading…" : "Upload mapping JSON"}
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                disabled={uploadBusy}
                onChange={(e) => void handleMappingUpload(e)}
              />
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Mapper JSON lives in{" "}
              <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">pdi-mappings/</code>. Sync CSV reports are
              written to <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">pdi-sync-exports/</code>.
            </p>
          </div>
          {uploadMessage ? (
            <p
              className={`text-xs ${uploadMessage.startsWith("Uploaded") ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
            >
              {uploadMessage}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-4 items-center">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "incremental" | "range")}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="incremental">Incremental (since last successful sync)</option>
            <option value="range">Date range</option>
          </select>
        </div>

        {mode === "range" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Start (YYYY-MM-DD)</label>
              <input
                value={start}
                onChange={(e) => setStart(e.target.value)}
                placeholder="2026-04-01"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">End (optional)</label>
              <input
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="Leave empty for today"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-6 items-center">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="rounded border-gray-300" />
            Dry run (no PDI posts)
          </label>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 dark:text-gray-400">Min records to advance sync cursor</label>
            <input
              type="number"
              min={0}
              value={minRecords}
              onChange={(e) => setMinRecords(Number(e.target.value))}
              className="w-24 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
            Rollback run ID (optional — Python engine only for now)
          </label>
          <input
            value={rollbackRun}
            onChange={(e) => setRollbackRun(e.target.value)}
            placeholder="ISO run_id from a previous sync"
            className="w-full text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>

        <button
          type="button"
          onClick={() => void runSync()}
          disabled={loading || parityLoading}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Running…" : "Run sync"}
        </button>
      </div>

      <ParityReportCard report={parityReport} loading={parityLoading} onRun={() => void runParityCheck()} />

      <SyncRunConsole events={logEvents} summary={tsSummary} status={runStatus} dryRun={dryRun} />

      {clientError ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-800 dark:text-red-200">
          {clientError}
        </div>
      ) : null}

      {pythonResult ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <p>
              <span className="font-semibold text-gray-800 dark:text-gray-200">Exit code:</span>{" "}
              {pythonResult.exitCode ?? "null"}
            </p>
            {pythonResult.mappingFile ? (
              <p className="text-xs font-mono break-all">
                <span className="font-semibold">Mapping:</span> {pythonResult.mappingFile}
              </p>
            ) : null}
          </div>
          <p className="text-xs font-mono text-gray-500 break-all">{pythonResult.command}</p>
          <p className="text-xs font-mono text-gray-500 break-all">{pythonResult.cwd}</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">stdout</h2>
              <pre className="text-xs font-mono bg-gray-950 text-gray-100 rounded-lg p-4 max-h-96 overflow-auto whitespace-pre-wrap break-words">
                {pythonResult.stdout || "(empty)"}
              </pre>
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">stderr</h2>
              <pre className="text-xs font-mono bg-gray-950 text-amber-100 rounded-lg p-4 max-h-96 overflow-auto whitespace-pre-wrap break-words">
                {pythonResult.stderr || "(empty)"}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
