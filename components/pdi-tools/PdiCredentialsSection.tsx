"use client";

import { useCallback, useEffect, useState } from "react";

type CredentialSource = "credentials-folder" | "env" | "none";

type StatusResponse = {
  credentialsDir: string;
  credentialsDirExists: boolean;
  filesInFolder: string[];
  gcp: {
    configured: boolean;
    source: CredentialSource;
    fileName: string | null;
    projectId: string | null;
  };
  pdi: {
    configured: boolean;
    source: CredentialSource;
    hasUsername: boolean;
    hasPassword: boolean;
    hasApiToken: boolean;
  };
};

function sourceLabel(s: CredentialSource): string {
  if (s === "credentials-folder") return "credentials folder";
  if (s === "env") return ".env.local / process env";
  return "not set";
}

export default function PdiCredentialsSection() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [gcpFile, setGcpFile] = useState<File | null>(null);
  const [pdiFile, setPdiFile] = useState<File | null>(null);
  const [pdiEnvText, setPdiEnvText] = useState("");

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/pdi/credentials");
      const data = (await res.json()) as StatusResponse & { error?: string };
      if (!res.ok) {
        setLoadError(data.error ?? res.statusText);
        return;
      }
      setStatus(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load status");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!gcpFile && !pdiFile && !pdiEnvText.trim()) {
      setMessage("Choose at least one file or paste PDI env lines.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      if (gcpFile) fd.append("gcpServiceAccount", gcpFile);
      if (pdiFile) fd.append("pdiCredentials", pdiFile);
      if (pdiEnvText.trim()) fd.append("pdiEnvText", pdiEnvText.trim());

      const res = await fetch("/api/pdi/credentials", { method: "POST", body: fd });
      const data = (await res.json()) as { ok?: boolean; status?: StatusResponse; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? "Upload failed");
        return;
      }
      if (data.status) setStatus(data.status);
      setMessage("Saved. Mapper refresh and Syncer will use these credentials.");
      setGcpFile(null);
      setPdiFile(null);
      setPdiEnvText("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="credentials" className="mt-10 scroll-mt-24">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Credentials</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Files in <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">campaign-dashboard/credentials/</code> are
        picked up automatically for live BigQuery + PDI API (Mapper) and for the Python sync (Syncer). You can also upload
        here — nothing is stored in the browser; the server writes to that folder only.
      </p>

      {loadError ? (
        <div className="mb-4 text-sm text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-2">
          {loadError}
        </div>
      ) : null}

      {status ? (
        <div className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 text-sm space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="font-semibold text-gray-800 dark:text-gray-200">GCP (BigQuery)</span>
            <StatusPill ok={status.gcp.configured} label={status.gcp.configured ? "Ready" : "Missing"} />
            <span className="text-gray-500 dark:text-gray-400 text-xs">
              {status.gcp.configured ? (
                <>
                  via {sourceLabel(status.gcp.source)}
                  {status.gcp.fileName ? ` · ${status.gcp.fileName}` : ""}
                  {status.gcp.projectId ? ` · project ${status.gcp.projectId}` : ""}
                </>
              ) : (
                "Upload a service account JSON or set GOOGLE_APPLICATION_CREDENTIALS."
              )}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="font-semibold text-gray-800 dark:text-gray-200">PDI API</span>
            <StatusPill ok={status.pdi.configured} label={status.pdi.configured ? "Ready" : "Incomplete"} />
            <span className="text-gray-500 dark:text-gray-400 text-xs">
              {sourceLabel(status.pdi.source)} · user {status.pdi.hasUsername ? "✓" : "—"} · pass{" "}
              {status.pdi.hasPassword ? "✓" : "—"} · token {status.pdi.hasApiToken ? "✓" : "—"}
            </span>
          </div>
          {status.credentialsDirExists && status.filesInFolder.length > 0 ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-600 dark:text-gray-300">Files detected:</span>{" "}
              {status.filesInFolder.join(", ")}
            </div>
          ) : status.credentialsDirExists ? (
            <div className="text-xs text-gray-500 dark:text-gray-400">Credentials folder exists but is empty.</div>
          ) : (
            <div className="text-xs text-amber-700 dark:text-amber-300">
              No <code className="px-0.5">credentials</code> folder yet — it will be created when you upload.
            </div>
          )}
        </div>
      ) : null}

      <form onSubmit={(e) => void onSubmit(e)} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
            GCP service account JSON
          </label>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => setGcpFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-3 file:rounded file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
          />
          <p className="mt-1 text-xs text-gray-500">Saved as credentials/gcp-service-account.json</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
            PDI credentials JSON
          </label>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => setPdiFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 dark:text-gray-200 file:mr-3 file:rounded file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
          />
          <p className="mt-1 text-xs text-gray-500">
            Use keys <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">PDI_USERNAME</code>,{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">PDI_PASSWORD</code>,{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">PDI_API_TOKEN</code> (or camelCase equivalents).
            Saved as credentials/pdi-credentials.json
          </p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
            Optional: PDI env lines (<code className="text-[10px]">KEY=value</code>)
          </label>
          <textarea
            value={pdiEnvText}
            onChange={(e) => setPdiEnvText(e.target.value)}
            rows={3}
            placeholder={"PDI_USERNAME=...\nPDI_PASSWORD=...\nPDI_API_TOKEN=..."}
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 font-mono"
          />
          <p className="mt-1 text-xs text-gray-500">Saved as credentials/pdi.env (merged with JSON on the server).</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save to credentials folder"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Refresh status
          </button>
        </div>
        {message ? (
          <p className={`text-sm ${message.startsWith("Saved") ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
        ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
      }`}
    >
      {label}
    </span>
  );
}
