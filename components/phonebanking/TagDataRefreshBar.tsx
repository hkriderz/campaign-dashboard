"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import RefreshProgressBar from "@/components/shared/RefreshProgressBar";
import SnapshotFreshnessLine from "@/components/phonebanking/SnapshotFreshnessLine";
import {
  fetchActivePhonebankingTags,
  progressToPercent,
  refreshPhonebankingTagsSequential,
  type TagRefreshProgress,
} from "@/lib/phonebanking-snapshot-refresh-client";
import { dispatchTombstoneOverlapCheck } from "@/lib/tombstone-overlap-events";

/**
 * BigQuery snapshot rebuild: this tag only and/or every phone-banking tag. Requires snapshot API secret.
 */
export default function TagDataRefreshBar({
  tagId,
  enabled,
  dataUpdatedAtIso,
  dataUpdatedAtLabel,
  isStale,
  hasSnapshotData,
}: {
  /** When set, shows “this tag” refresh and per-tag snapshot timestamps. Omit on the landing page for global-only UI. */
  tagId?: string;
  enabled: boolean;
  dataUpdatedAtIso?: string | null;
  dataUpdatedAtLabel?: string;
  isStale?: boolean;
  hasSnapshotData?: boolean;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState<null | "tag" | "all">(null);
  const [progress, setProgress] = useState<TagRefreshProgress | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "warn" | "err">("ok");

  async function postRefresh(body: Record<string, unknown>) {
    const res = await fetch("/api/phonebanking/bq-snapshot-refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-snapshot-secret": secret,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { res, data };
  }

  async function onRefreshThisTag() {
    if (!secret.trim() || !tagId) return;
    setLoading("tag");
    setMessage("");
    setProgress({
      completed: 0,
      total: 1,
      currentTagId: tagId,
      currentTagLabel: tagId,
      phase: "refreshing",
    });
    try {
      const { res, data } = await postRefresh({ tagId, clear: false });
      if (!res.ok) {
        setMessageTone("err");
        setMessage(data.error ?? res.statusText);
        return;
      }
      setProgress({
        completed: 1,
        total: 1,
        currentTagId: null,
        currentTagLabel: null,
        phase: "done",
      });
      setMessageTone("ok");
      setMessage("This tag’s snapshots updated.");
      router.refresh();
      dispatchTombstoneOverlapCheck(tagId);
    } catch (err) {
      setMessageTone("err");
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
      setTimeout(() => setProgress(null), 1500);
    }
  }

  async function onRefreshAllTags() {
    if (!secret.trim()) return;
    setLoading("all");
    setMessage("");
    setProgress({
      completed: 0,
      total: 0,
      currentTagId: null,
      currentTagLabel: null,
      phase: "loading-tags",
    });

    try {
      const tags = await fetchActivePhonebankingTags();
      const tagIds = tags.map((t) => t.id);
      const tagLabels = new Map(tags.map((t) => [t.id, t.label]));

      if (tagIds.length === 0) {
        setMessageTone("warn");
        setMessage("No phone-banking tags to refresh.");
        return;
      }

      const { refreshed, errors } = await refreshPhonebankingTagsSequential({
        tagIds,
        tagLabels,
        secret: secret.trim(),
        clearFirst: false,
        onProgress: setProgress,
      });

      if (refreshed.length === 0 && errors.length > 0) {
        setMessageTone("err");
        setMessage(
          `Every tag failed: ${errors.map((e) => `${e.tagId}: ${e.error}`).join("; ")}`
        );
      } else if (errors.length > 0) {
        setMessageTone("warn");
        setMessage(
          `Updated ${refreshed.length} tag(s). ${errors.length} failed: ${errors.map((e) => `${e.tagId}: ${e.error}`).join("; ")}`
        );
      } else {
        setMessageTone("ok");
        setMessage(`Updated all ${refreshed.length} phone-banking tag(s).`);
      }
      router.refresh();
    } catch (err) {
      setMessageTone("err");
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
      setTimeout(() => setProgress(null), 2000);
    }
  }

  const emptySnapshotHint = tagId
    ? "(no snapshot — refresh to populate)"
    : "(no snapshots on disk for any tag yet)";

  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 space-y-1.5">
        <SnapshotFreshnessLine
          dataUpdatedAtIso={dataUpdatedAtIso}
          dataUpdatedAtLabel={dataUpdatedAtLabel}
          isStale={isStale}
          hasSnapshotData={hasSnapshotData}
          emptySnapshotHint={emptySnapshotHint}
        />
        <p>
          Set <code className="text-[11px]">CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET</code> in{" "}
          <code className="text-[11px]">.env.local</code> to enable refresh actions (full BigQuery pulls).
        </p>
      </div>
    );
  }

  const busy = loading !== null;
  const progressLabel =
    loading === "all"
      ? progress?.phase === "loading-tags"
        ? "Loading tag list…"
        : progress?.phase === "done"
          ? "Refresh complete"
          : "Refreshing snapshots"
      : loading === "tag"
        ? progress?.phase === "done"
          ? "Refresh complete"
          : "Refreshing this tag"
        : "";

  const progressDetail =
    progress && progress.currentTagLabel && progress.phase === "refreshing"
      ? `${progress.completed + 1} of ${progress.total} — ${progress.currentTagLabel}`
      : progress && progress.total > 0 && progress.phase !== "loading-tags"
        ? `${progress.completed} of ${progress.total} tags done`
        : undefined;

  const progressPercent =
    progress && loading === "all"
      ? progressToPercent(progress)
      : loading === "tag" && progress
        ? progress.phase === "done"
          ? 100
          : 50
        : undefined;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40 px-3 py-2 space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="text-xs text-gray-600 dark:text-gray-400 min-w-0">
          <SnapshotFreshnessLine
            dataUpdatedAtIso={dataUpdatedAtIso}
            dataUpdatedAtLabel={dataUpdatedAtLabel}
            isStale={isStale}
            hasSnapshotData={hasSnapshotData}
            emptySnapshotHint={emptySnapshotHint}
          />
          <span className="block mt-1 text-[11px] text-gray-500 dark:text-gray-500 leading-snug">
            Dashboards read JSON on disk.{" "}
            {tagId ? (
              <>
                <strong>Refresh this tag</strong> updates only the open candidate;{" "}
              </>
            ) : null}
            <strong>Refresh all tags</strong> runs a full BigQuery export for every phone-banking tag (one at a time —
            progress shown below).
          </span>
        </div>
        <div className="flex flex-col gap-2 shrink-0 sm:items-end">
          <input
            type="password"
            autoComplete="off"
            aria-label="Snapshot secret"
            placeholder="Secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full sm:w-32 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
          />
          <div className="flex flex-wrap gap-2 justify-end">
            {tagId ? (
              <button
                type="button"
                onClick={onRefreshThisTag}
                disabled={busy || !secret.trim()}
                className="rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1 text-xs font-medium"
              >
                {loading === "tag" ? "Refreshing…" : "Refresh this tag"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRefreshAllTags}
              disabled={busy || !secret.trim()}
              className="rounded bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white px-3 py-1 text-xs font-medium"
            >
              {loading === "all" ? "Refreshing all…" : "Refresh all tags"}
            </button>
          </div>
        </div>
      </div>

      {busy && progressLabel ? (
        <RefreshProgressBar
          percent={progressPercent}
          label={progressLabel}
          detail={progressDetail}
        />
      ) : null}

      {message ? (
        <p
          className={
            messageTone === "err"
              ? "text-xs text-red-700 dark:text-red-400"
              : messageTone === "warn"
                ? "text-xs text-amber-800 dark:text-amber-300"
                : "text-xs text-emerald-700 dark:text-emerald-400"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
