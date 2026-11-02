"use client";

import { useState } from "react";
import type { ReportDefaultKind } from "@/lib/report-defaults/types";

type Props = {
  kind: ReportDefaultKind;
  /** Current form settings to persist (kind-specific shape). */
  getSettings: () => unknown;
  /** Apply settings returned from the API to the form. */
  applySettings: (settings: unknown, source: "system" | "built-in") => void;
  className?: string;
};

export default function SystemDefaultsControls({
  kind,
  getSettings,
  applySettings,
  className = "",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setAsSystemDefault() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/report-defaults/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: getSettings() }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; data?: { settings: unknown } };
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to save system default.");
      applySettings(json.data.settings, "system");
      setMessage("Saved as system default for everyone.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetToBuiltIn() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/report-defaults/${kind}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string; data?: { settings: unknown } };
      if (!json.ok || !json.data) throw new Error(json.error || "Unable to reset defaults.");
      applySettings(json.data.settings, "built-in");
      setMessage("Reset to built-in defaults.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void setAsSystemDefault()}
          className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
        >
          Set as system default
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resetToBuiltIn()}
          className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900"
        >
          Reset to built-in
        </button>
      </div>
      {message ? <p className="text-xs text-emerald-700 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

/** Fetch system (or built-in) defaults for a report kind. */
export async function fetchReportDefaults(kind: ReportDefaultKind): Promise<{
  source: "system" | "built-in";
  settings: unknown;
}> {
  const res = await fetch(`/api/report-defaults/${kind}`);
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    data?: { source: "system" | "built-in"; settings: unknown };
  };
  if (!json.ok || !json.data) throw new Error(json.error || "Unable to load report defaults.");
  return json.data;
}
