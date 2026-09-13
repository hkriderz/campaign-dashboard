"use client";

import SnapshotFreshnessLine from "@/components/phonebanking/SnapshotFreshnessLine";
import type { SurveyScriptProfile } from "@/lib/types";
import type { StoredCampaignTagV1 } from "@/lib/campaign-tags-file";
import {
  editorModeFromStored,
  isCampaignTagMode,
  isEditorChannelMode,
  modeAllowsQc,
  resolveIncludeInTexting,
  storedFromEditorMode,
} from "@/lib/campaign-tag-mode";
import type { SnapshotFreshnessMeta } from "@/lib/tag-dashboard-snapshot";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type ActiveTagRow = {
  id: string;
  label: string;
  navGroup: string | null;
  isQc: boolean;
  mode: string;
};

type ApiGetResponse = {
  configPath: string;
  source: "file" | "default";
  tags: StoredCampaignTagV1[];
  activePhonebankingTags: ActiveTagRow[];
};

function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || "candidate";
}

function cloneRow(r: StoredCampaignTagV1): StoredCampaignTagV1 {
  return {
    ...r,
    searchTerms: [...r.searchTerms],
    campaignCodes: r.campaignCodes ? [...r.campaignCodes] : undefined,
    oppositionSearchTerms: r.oppositionSearchTerms
      ? [...r.oppositionSearchTerms]
      : undefined,
    includeInTexting: resolveIncludeInTexting(r.includeInTexting, r.mode),
  };
}

function newEmptyRow(): StoredCampaignTagV1 {
  return {
    id: "",
    label: "",
    searchTerms: [],
    campaignCodes: undefined,
    enableQc: false,
    oppositionMode: "none",
    oppositionSearchTerms: undefined,
    color: "#4f46e5",
    textColor: "#ffffff",
    mode: "both",
    includeInTexting: true,
  };
}

export default function CampaignTagsClient({
  initialTags,
  initialSource,
  initialActiveTags,
  configPath,
  snapshotsMeta,
}: {
  initialTags: StoredCampaignTagV1[];
  initialSource: "file" | "default";
  initialActiveTags: ActiveTagRow[];
  configPath: string;
  snapshotsMeta: SnapshotFreshnessMeta;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<StoredCampaignTagV1[]>(() =>
    initialTags.map(cloneRow)
  );
  const [activeTags, setActiveTags] = useState<ActiveTagRow[]>(initialActiveTags);
  const [activeLoading, setActiveLoading] = useState(false);
  const [source, setSource] = useState(initialSource);
  const [secret, setSecret] = useState("");
  const [refreshBq, setRefreshBq] = useState(false);
  const [clearSnapshots, setClearSnapshots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err">("ok");
  const scrollNewCandidateIndexRef = useRef<number | null>(null);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);

  const loadActive = useCallback(async (opts?: { showSpinner?: boolean }) => {
    if (opts?.showSpinner !== false) {
      setActiveLoading(true);
    }
    try {
      const res = await fetch("/api/campaign-tags", { cache: "no-store" });
      const data = (await res.json()) as ApiGetResponse;
      if (res.ok) {
        setActiveTags(data.activePhonebankingTags);
        setSource(data.source);
      }
    } finally {
      setActiveLoading(false);
    }
  }, []);

  const rowCount = rows.length;
  useEffect(() => {
    const idx = scrollNewCandidateIndexRef.current;
    if (idx === null) return;
    scrollNewCandidateIndexRef.current = null;
    const id = `campaign-tag-candidate-${idx}`;
    requestAnimationFrame(() => {
      const root = document.getElementById(id);
      root?.scrollIntoView({ behavior: "smooth", block: "start" });
      root?.querySelector<HTMLInputElement>("input[required]")?.focus();
    });
  }, [rowCount]);

  function addCandidate() {
    setRows((prev) => {
      scrollNewCandidateIndexRef.current = prev.length;
      return [...prev, newEmptyRow()];
    });
  }

  function confirmRemoveRow(i: number) {
    const label = rows[i]?.label?.trim();
    const detail = label ? ` “${label}”` : "";
    if (
      !window.confirm(
        `Remove this candidate${detail} from the list? You can undo by reloading the page before saving.`
      )
    ) {
      return;
    }
    setRemovingIndex(i);
    window.setTimeout(() => {
      setRows((prev) => prev.filter((_, j) => j !== i));
      setRemovingIndex(null);
    }, 320);
  }

  function updateRow(i: number, patch: Partial<StoredCampaignTagV1>) {
    setRows((prev) => {
      const next = [...prev];
      const cur = next[i];
      if (!cur) return prev;
      next[i] = { ...cur, ...patch };
      return next;
    });
  }

  /** Split lines and trim each line, but keep empty lines so Enter can add a new row in the textarea. */
  function setSearchTermsFromText(i: number, text: string) {
    const terms = text.split(/\r?\n/).map((line) => line.trim());
    updateRow(i, { searchTerms: terms });
  }

  function setCodesFromText(i: number, text: string) {
    const codes = text
      .split(/[,;\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    updateRow(i, { campaignCodes: codes.length ? codes : undefined });
  }

  function setOppositionTermsFromText(i: number, text: string) {
    const terms = text.split(/\r?\n/).map((line) => line.trim());
    const nonEmpty = terms.some((t) => t.length > 0);
    updateRow(i, {
      oppositionSearchTerms: nonEmpty ? terms : undefined,
    });
  }

  function showSecretError(text: string) {
    setMessageTone("err");
    setMessage(text);
    secretInputRef.current?.focus();
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) {
      showSecretError("Enter the snapshot secret to save. It is required to write tags to disk.");
      return;
    }

    const prepared = rows.map((r) => {
      const id = r.id.trim() || slugify(r.label);
      return {
        ...r,
        id,
        searchTerms: r.searchTerms.map((t) => t.trim()).filter((t) => t.length > 0),
        oppositionSearchTerms: r.oppositionSearchTerms
          ? r.oppositionSearchTerms.map((t) => t.trim()).filter((t) => t.length > 0)
          : undefined,
      };
    });

    for (const r of prepared) {
      if (!r.label.trim()) {
        setMessageTone("err");
        setMessage("Each row needs a candidate label.");
        return;
      }
    }

    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/campaign-tags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-snapshot-secret": secret,
        },
        body: JSON.stringify({
          tags: prepared,
          refreshBigQuery: refreshBq,
          clearSnapshots: refreshBq && clearSnapshots,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        activePhonebankingTags?: ActiveTagRow[];
        snapshotRefresh?: {
          ok?: boolean;
          error?: string;
          message?: string;
          refreshed?: string[];
          errors?: { tagId: string; error: string }[];
        } | null;
      };

      if (!res.ok) {
        if (res.status === 401 || data.error === "Unauthorized") {
          showSecretError("That snapshot secret is incorrect. Check it and try again.");
          return;
        }
        setMessageTone("err");
        setMessage(data.error ?? res.statusText);
        return;
      }

      const snap = data.snapshotRefresh;
      if (refreshBq && snap && "ok" in snap && snap.ok === false) {
        setMessageTone("err");
        setMessage(
          `Saved campaign tags, but BigQuery refresh failed: ${snap.error ?? "unknown error"}.`
        );
      } else if (
        refreshBq &&
        snap &&
        "errors" in snap &&
        Array.isArray(snap.errors) &&
        snap.errors.length > 0
      ) {
        setMessageTone("err");
        setMessage(
          `Saved. Some snapshot rebuilds failed: ${snap.errors.map((e) => `${e.tagId}: ${e.error}`).join("; ")}.`
        );
      } else {
        setMessageTone("ok");
        setMessage(
          refreshBq
            ? "Saved campaign tags and refreshed BigQuery snapshots for all phone-banking tags."
            : "Saved campaign tags. Reload or revisit a candidate page to use new slugs."
        );
      }
      if (data.activePhonebankingTags) {
        setActiveTags(data.activePhonebankingTags);
      }
      setSource("file");
      router.refresh();
      void loadActive({ showSpinner: false });
    } catch (err) {
      setMessageTone("err");
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1 flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href="/phonebanking"
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Phone banking
          </Link>
          <Link
            href="/texting"
            className="text-teal-700 dark:text-teal-300 hover:underline"
          >
            ← Texting
          </Link>
        </p>
        <p className="section-kicker">Config</p>
        <h1 className="font-display text-3xl font-semibold text-[var(--section-ink)]">
          Campaign tags
        </h1>
        <hr className="section-hero__rule" />
        <p className="text-gray-600 dark:text-gray-400 text-sm mt-2">
          Tags are stored in{" "}
          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">
            {configPath}
          </code>
          . Saving writes that file and uses the same snapshot secret as BigQuery refresh. When no
          file exists yet, defaults are built in until you save once.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
          Config source:{" "}
          <span className="font-semibold text-gray-700 dark:text-gray-300">
            {source === "file" ? "file on disk" : "built-in defaults (not saved yet)"}
          </span>
        </p>
      </div>

      <form onSubmit={onSave} className="space-y-6">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4 bg-gray-50/50 dark:bg-gray-800/20">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Save changes
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Enter the snapshot secret, then save. The secret is required to write tags to disk
              (same value as BigQuery snapshot refresh). Add candidate only adds a form row and
              does not need the secret.
            </p>
          </div>
          <SnapshotFreshnessLine
            dataUpdatedAtIso={snapshotsMeta.dataUpdatedAt}
            dataUpdatedAtLabel={snapshotsMeta.dataUpdatedAtLabel}
            isStale={snapshotsMeta.isStale}
            hasSnapshotData={snapshotsMeta.hasDailyCaller}
            emptySnapshotHint="(no snapshots on disk for any tag yet)"
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-gray-800 dark:text-gray-200">
              Snapshot secret <span className="text-red-600 dark:text-red-400">required to save</span>
            </span>
            <input
              ref={secretInputRef}
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Paste the snapshot secret"
              aria-required="true"
              aria-invalid={messageTone === "err" && message.toLowerCase().includes("secret")}
              className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm max-w-md"
            />
          </label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={refreshBq}
                onChange={(e) => setRefreshBq(e.target.checked)}
              />
              Re-run BigQuery snapshot jobs for every active tag after save
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={clearSnapshots}
                onChange={(e) => setClearSnapshots(e.target.checked)}
                disabled={!refreshBq}
              />
              Clear existing snapshots first
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={addCandidate}
              disabled={removingIndex !== null}
              className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm disabled:opacity-50"
            >
              Add candidate
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 text-sm font-medium"
            >
              {saving ? "Saving…" : "Save to disk"}
            </button>
          </div>
          {message ? (
            <p
              role="status"
              className={
                messageTone === "err"
                  ? "text-sm text-red-700 dark:text-red-400"
                  : "text-sm text-emerald-700 dark:text-emerald-400"
              }
            >
              {message}
            </p>
          ) : null}
        </div>

        <section
          className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 p-4 shadow-sm"
          aria-labelledby="active-tags-heading"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2
              id="active-tags-heading"
              className="text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              Currently active phone banking tags
            </h2>
            <button
              type="button"
              onClick={() => void loadActive({ showSpinner: true })}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
              disabled={activeLoading}
            >
              {activeLoading ? "Loading…" : "Refresh list"}
            </button>
          </div>
          {activeLoading && activeTags.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
              {activeTags.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm bg-gray-50/80 dark:bg-gray-800/30"
                >
                  <code className="text-xs font-mono text-indigo-700 dark:text-indigo-300">
                    {t.id}
                  </code>
                  <span className="text-gray-900 dark:text-gray-100">{t.label}</span>
                  {t.isQc ? (
                    <span className="text-[10px] uppercase font-semibold tracking-wide rounded bg-violet-100 dark:bg-violet-900/50 text-violet-800 dark:text-violet-200 px-1.5 py-0.5">
                      QC
                    </span>
                  ) : null}
                  {t.navGroup ? (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      ({t.navGroup})
                    </span>
                  ) : null}
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
                    {t.mode}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!activeLoading && activeTags.length === 0 ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              No phone banking tags resolved. Use Add candidate, fill the form, then save.
            </p>
          ) : null}
        </section>

        {rows.map((row, i) => (
          <fieldset
            key={i}
            id={`campaign-tag-candidate-${i}`}
            className={[
              "rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4 bg-white dark:bg-gray-900/40 scroll-mt-24",
              "transition-all duration-300 ease-in-out motion-reduce:transition-none",
              removingIndex === i
                ? "opacity-0 scale-[0.98] -translate-y-3 blur-[1px] pointer-events-none"
                : "opacity-100 scale-100 translate-y-0 blur-0",
            ].join(" ")}
          >
            <legend className="text-sm font-semibold px-1 text-gray-800 dark:text-gray-200">
              Candidate {i + 1}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-gray-600 dark:text-gray-400">Candidate name</span>
                <input
                  value={row.label}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
                  required
                />
              </label>
              <div className="flex flex-col gap-1 text-xs">
                <span className="text-gray-600 dark:text-gray-400">URL slug (id)</span>
                <div className="flex gap-2">
                  <input
                    value={row.id}
                    onChange={(e) =>
                      updateRow(i, { id: e.target.value.toLowerCase().replace(/\s+/g, "-") })
                    }
                    placeholder={slugify(row.label)}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm font-mono"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs"
                    onClick={() => updateRow(i, { id: slugify(row.label) })}
                  >
                    From name
                  </button>
                </div>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-600 dark:text-gray-400">
                Search tags / aliases (one per line — press Enter for a new line; matched on campaign name)
              </span>
              <textarea
                value={row.searchTerms.join("\n")}
                onChange={(e) => setSearchTermsFromText(i, e.target.value)}
                rows={4}
                className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm font-mono"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-600 dark:text-gray-400">
                Campaign codes (optional, comma-separated, e.g. EUN, ADA)
              </span>
              <input
                value={(row.campaignCodes ?? []).join(", ")}
                onChange={(e) => setCodesFromText(i, e.target.value)}
                className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm font-mono"
              />
            </label>

            <div className="space-y-2">
              <span className="text-xs text-gray-600 dark:text-gray-400">Opposition</span>
              <div className="flex flex-wrap gap-3 text-xs">
                {(["none", "named", "other"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name={`opp-${i}`}
                      checked={row.oppositionMode === m}
                      onChange={() =>
                        updateRow(i, {
                          oppositionMode: m,
                          oppositionSearchTerms: m === "named" ? row.oppositionSearchTerms : undefined,
                        })
                      }
                    />
                    {m === "none"
                      ? "None"
                      : m === "named"
                        ? "Named (extra search terms)"
                        : "Other (generic oppose phrases)"}
                  </label>
                ))}
              </div>
              {row.oppositionMode === "named" ? (
                <textarea
                  value={(row.oppositionSearchTerms ?? []).join("\n")}
                  onChange={(e) => setOppositionTermsFromText(i, e.target.value)}
                  rows={2}
                  placeholder="Opponent names / phrases, one per line"
                  className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm font-mono"
                />
              ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-gray-600 dark:text-gray-400">Mode</span>
                <select
                  value={editorModeFromStored(
                    isCampaignTagMode(row.mode) ? row.mode : "both",
                    row.includeInTexting === true
                  )}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!isEditorChannelMode(next)) return;
                    const { mode, includeInTexting } = storedFromEditorMode(next);
                    updateRow(i, {
                      mode,
                      includeInTexting,
                      enableQc: modeAllowsQc(mode) ? row.enableQc : false,
                    });
                  }}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
                >
                  <option value="all">Phone banking, canvassing &amp; texting</option>
                  <option value="both">Phone banking &amp; canvassing</option>
                  <option value="phonebanking-texting">Phone banking &amp; texting</option>
                  <option value="canvassing-texting">Canvassing &amp; texting</option>
                  <option value="phonebanking">Phone banking only</option>
                  <option value="canvassing">Canvassing only</option>
                  <option value="texting">Texting only</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs mt-6 sm:mt-0">
                <input
                  type="checkbox"
                  checked={row.enableQc}
                  onChange={(e) => updateRow(i, { enableQc: e.target.checked })}
                  disabled={!modeAllowsQc(row.mode)}
                />
                <span className="text-gray-700 dark:text-gray-300">
                  QC bucket (<code className="text-[10px]">qc-…</code> ∧ candidate)
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span>Color</span>
                <input
                  type="color"
                  value={row.color}
                  onChange={(e) => updateRow(i, { color: e.target.value })}
                  className="h-9 w-full rounded border border-gray-300 dark:border-gray-600"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span>Text</span>
                <input
                  type="color"
                  value={row.textColor}
                  onChange={(e) => updateRow(i, { textColor: e.target.value })}
                  className="h-9 w-full rounded border border-gray-300 dark:border-gray-600"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="text-gray-600 dark:text-gray-400">Survey script profile</span>
                <select
                  value={row.surveyScriptProfile ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateRow(i, {
                      surveyScriptProfile:
                        v === ""
                          ? undefined
                          : (v as SurveyScriptProfile),
                    });
                  }}
                  className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
                >
                  <option value="">Auto (from slug)</option>
                  <option value="faizahTraci">faizahTraci</option>
                  <option value="eunissesTwoWay">eunissesTwoWay</option>
                  <option value="genericChallenger">genericChallenger</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-gray-700 dark:text-gray-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.showPollingAggregate === true}
                  onChange={(e) =>
                    updateRow(i, {
                      showPollingAggregate: e.target.checked ? true : undefined,
                    })
                  }
                />
                Show polling block
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.useCallLevelFinalResultFill === true}
                  onChange={(e) =>
                    updateRow(i, {
                      useCallLevelFinalResultFill: e.target.checked ? true : undefined,
                    })
                  }
                />
                Call-level final result fill
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.verbatimFinalResultAggregate === true}
                  onChange={(e) =>
                    updateRow(i, {
                      verbatimFinalResultAggregate: e.target.checked ? true : undefined,
                    })
                  }
                />
                Verbatim final result aggregate
              </label>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-40 disabled:no-underline"
                disabled={removingIndex !== null}
                onClick={() => confirmRemoveRow(i)}
              >
                Remove candidate
              </button>
            </div>
          </fieldset>
        ))}
      </form>
    </div>
  );
}
