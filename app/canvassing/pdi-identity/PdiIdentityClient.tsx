"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import PdiIdentityCsvImport from "@/components/pdi-identity/PdiIdentityCsvImport";
import PdiIdentityGapTallyChips from "@/components/pdi-identity/PdiIdentityGapTally";
import type { PdiIdentityGapTally } from "@/lib/pdi-identity/gaps";
import type { PdiIdentityRecord } from "@/lib/pdi-identity/types";

type ApiListResponse = {
  ok: boolean;
  error?: string;
  data?: { records: PdiIdentityRecord[]; count: number };
};

type GapsResponse = {
  ok: boolean;
  error?: string;
  data?: { gaps: PdiIdentityGapTally };
};

type ApiMutateResponse = {
  ok: boolean;
  error?: string;
  data?: {
    savedCount?: number;
    skippedNoPdiId?: number;
    skippedLines?: number;
    deleted?: string[];
    deletedCount?: number;
    records: PdiIdentityRecord[];
  };
};

export default function PdiIdentityClient() {
  const [records, setRecords] = useState<PdiIdentityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [pdiId, setPdiId] = useState("");
  const [voterName, setVoterName] = useState("");
  const [voterAddress, setVoterAddress] = useState("");
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [gaps, setGaps] = useState<PdiIdentityGapTally | null>(null);
  const [gapsLoading, setGapsLoading] = useState(true);

  const loadGaps = useCallback(async () => {
    setGapsLoading(true);
    try {
      const res = await fetch("/api/pdi-identity/gaps");
      const json = (await res.json()) as GapsResponse;
      if (json.ok && json.data) setGaps(json.data.gaps);
    } catch {
      /* optional tally */
    } finally {
      setGapsLoading(false);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pdi-identity");
      const json = (await res.json()) as ApiListResponse;
      if (!json.ok || !json.data) throw new Error(json.error || "Failed to load PDI identities.");
      setRecords(json.data.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
    void loadGaps();
  }, [loadRecords, loadGaps]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/\s+/g, "");
    if (!needle) return records;
    return records.filter((row) => {
      const id = row.pdiId.toLowerCase();
      const name = row.voterName.toLowerCase();
      const address = row.voterAddress.toLowerCase();
      return (
        id.includes(needle) ||
        name.includes(query.trim().toLowerCase()) ||
        address.includes(query.trim().toLowerCase())
      );
    });
  }, [query, records]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((row) => selected.has(row.pdiId));

  async function saveSingle(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pdi-identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: [{ pdiId, voterName, voterAddress, note, replaceEmpty: true }],
        }),
      });
      const json = (await res.json()) as ApiMutateResponse;
      if (!json.ok || !json.data) throw new Error(json.error || "Save failed.");
      setRecords(json.data.records);
      setMessage(`Saved ${json.data.savedCount ?? 1} identity.`);
      setPdiId("");
      setVoterName("");
      setVoterAddress("");
      setNote("");
      void loadGaps();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function savePaste(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pdi-identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paste, replaceEmpty: false }),
      });
      const json = (await res.json()) as ApiMutateResponse;
      if (!json.ok || !json.data) throw new Error(json.error || "Paste save failed.");
      setRecords(json.data.records);
      const skipped = (json.data.skippedNoPdiId ?? 0) + (json.data.skippedLines ?? 0);
      setMessage(
        `Saved ${json.data.savedCount ?? 0} identities${
          skipped ? ` · skipped ${skipped} line(s)` : ""
        }.`
      );
      setPaste("");
      void loadGaps();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} selected identities?`)) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pdi-identity", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdiIds: [...selected] }),
      });
      const json = (await res.json()) as ApiMutateResponse;
      if (!json.ok || !json.data) throw new Error(json.error || "Delete failed.");
      setRecords(json.data.records);
      setMessage(`Deleted ${json.data.deletedCount ?? json.data.deleted?.length ?? selected.size} identities.`);
      setSelected(new Set());
      void loadGaps();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteAll() {
    if (!records.length) return;
    if (
      !window.confirm(
        `Delete ALL ${records.length} saved PDI identities?\n\nThis cannot be undone except by re-importing.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pdi-identity", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const json = (await res.json()) as ApiMutateResponse;
      if (!json.ok || !json.data) throw new Error(json.error || "Delete all failed.");
      setRecords(json.data.records);
      setMessage(`Deleted all ${json.data.deletedCount ?? records.length} identities.`);
      setSelected(new Set());
      void loadGaps();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelected((current) => {
      if (allFilteredSelected) {
        const next = new Set(current);
        for (const row of filtered) next.delete(row.pdiId);
        return next;
      }
      const next = new Set(current);
      for (const row of filtered) next.add(row.pdiId);
      return next;
    });
  }

  function editRow(row: PdiIdentityRecord) {
    setPdiId(row.pdiId);
    setVoterName(row.voterName);
    setVoterAddress(row.voterAddress);
    setNote(row.note ?? "");
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">PDI identity lookup</h1>
        <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Store voter names and addresses by PDI / PRIMARYID. Import a CSV with column mapping, add
          one ID at a time, or paste rows. Saved rows fill blank name and address fields on Unique IDs
          / QC matching.{" "}
          <Link href="/canvassing/overview" className="font-medium text-sky-700 hover:underline dark:text-sky-400">
            Open Unique IDs
          </Link>
        </p>
      </header>

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

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Import CSV</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Tallies below update after each import. Missing counts come from Unique IDs across candidates.
          </p>
        </div>
        <PdiIdentityGapTallyChips gaps={gaps} loading={gapsLoading} />
        <PdiIdentityCsvImport
          compact
          onImported={(nextRecords, summary) => {
            setRecords(nextRecords);
            setMessage(summary);
            setError(null);
            void loadGaps();
          }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={(event) => void saveSingle(event)}
          className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900"
        >
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Add or update one ID</h2>
          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">PDI ID</span>
            <input
              value={pdiId}
              onChange={(e) => setPdiId(e.target.value)}
              required
              placeholder="CA12345678"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-sm dark:border-white/10 dark:bg-gray-950"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Name</span>
            <input
              value={voterName}
              onChange={(e) => setVoterName(e.target.value)}
              placeholder="First Last"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Address</span>
            <input
              value={voterAddress}
              onChange={(e) => setVoterAddress(e.target.value)}
              placeholder="123 Main St, City, CA 90000"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Source / reason"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !pdiId.trim()}
            className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-800 disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            {saving ? "Saving…" : "Save identity"}
          </button>
        </form>

        <form
          onSubmit={(event) => void savePaste(event)}
          className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900"
        >
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Paste rows (optional)</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Prefer CSV import above for column mapping. Paste still accepts{" "}
            <code className="text-xs">PDI ID[tab]Name[tab]Address</code>.
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={10}
            placeholder={"CA123\tAda Lovelace\t1 Main St\nCA456\tGrace Hopper\t2 Oak Ave"}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs dark:border-white/10 dark:bg-gray-950"
          />
          <button
            type="submit"
            disabled={saving || !paste.trim()}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/5"
          >
            {saving ? "Saving…" : "Save pasted rows"}
          </button>
        </form>
      </div>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Saved identities</h2>
            <p className="text-xs text-gray-500">
              {loading ? "Loading…" : `${filtered.length} of ${records.length} shown`}
              {selected.size ? ` · ${selected.size} selected` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by PDI, name, or address"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950"
            />
            <button
              type="button"
              onClick={() => void loadRecords()}
              className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              disabled={!filtered.length}
              className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            >
              {allFilteredSelected ? "Clear selection" : "Select all"}
            </button>
            <button
              type="button"
              onClick={() => void deleteSelected()}
              disabled={!selected.size || saving}
              className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              Delete selected ({selected.size})
            </button>
            <button
              type="button"
              onClick={() => void deleteAll()}
              disabled={!records.length || saving}
              className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
            >
              Delete all
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-950 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    disabled={!filtered.length}
                    aria-label="Select all visible"
                  />
                </th>
                <th className="px-3 py-2">PDI ID</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-500">
                    {loading ? "Loading…" : "No saved identities yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.pdiId} className="border-t border-gray-100 dark:border-white/5">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.pdiId)}
                        onChange={() => toggleSelected(row.pdiId)}
                        aria-label={`Select ${row.pdiId}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.pdiId}</td>
                    <td className="px-3 py-2">{row.voterName || "—"}</td>
                    <td className="px-3 py-2">{row.voterAddress || "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => editRow(row)}
                        className="text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
