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
 * Ops-only: same API as “Refresh all data” — full BigQuery pull and overwrite snapshot JSON.
 * Optional “clear first” deletes existing files before rebuilding (cold start).
 */
export default function BqSnapshotRefreshPanel({
  tagId,
  dataUpdatedAtIso,
  dataUpdatedAtLabel,
  isStale,
  hasSnapshotData,
}: {
  tagId: string;
  dataUpdatedAtIso?: string | null;
  dataUpdatedAtLabel?: string;
  isStale?: boolean;
  hasSnapshotData?: boolean;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [clearFirst, setClearFirst] = useState(false);
  const [allTags, setAllTags] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<TagRefreshProgress | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    setProgress(null);

    try {
      if (allTags) {
        setProgress({
          completed: 0,
          total: 0,
          currentTagId: null,
          currentTagLabel: null,
          phase: "loading-tags",
        });
        const tags = await fetchActivePhonebankingTags();
        const tagIds = tags.map((t) => t.id);
        const tagLabels = new Map(tags.map((t) => [t.id, t.label]));

        const { refreshed, errors } = await refreshPhonebankingTagsSequential({
          tagIds,
          tagLabels,
          secret: secret.trim(),
          clearFirst,
          onProgress: setProgress,
        });

        if (refreshed.length === 0 && errors.length > 0) {
          setStatus("err");
          setMessage(
            `Every tag failed: ${errors.map((e) => `${e.tagId}: ${e.error}`).join("; ")}`
          );
        } else if (errors.length > 0) {
          setStatus("ok");
          setMessage(
            `Rebuilt ${refreshed.length} tag(s); ${errors.length} error(s). Check server logs or retry failed tags.`
          );
        } else {
          setStatus("ok");
          setMessage("All tag snapshot files rewritten from BigQuery.");
        }
      } else {
        setProgress({
          completed: 0,
          total: 1,
          currentTagId: tagId,
          currentTagLabel: tagId,
          phase: "refreshing",
        });
        const res = await fetch("/api/phonebanking/bq-snapshot-refresh", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-snapshot-secret": secret,
          },
          body: JSON.stringify({ tagId, clear: clearFirst }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setStatus("err");
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
        setStatus("ok");
        setMessage("Snapshot files rewritten from BigQuery.");
        dispatchTombstoneOverlapCheck(tagId);
      }
      router.refresh();
    } catch (err) {
      setStatus("err");
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => setProgress(null), 2000);
    }
  }

  const progressLabel =
    status === "loading"
      ? allTags
        ? progress?.phase === "loading-tags"
          ? "Loading tag list…"
          : progress?.phase === "done"
            ? "Rebuild complete"
            : "Rebuilding snapshots"
        : progress?.phase === "done"
          ? "Rebuild complete"
          : "Rebuilding this tag"
      : "";

  const progressDetail =
    progress && progress.currentTagLabel && progress.phase === "refreshing"
      ? `${progress.completed + 1} of ${progress.total} — ${progress.currentTagLabel}`
      : progress && progress.total > 0 && progress.phase !== "loading-tags"
        ? `${progress.completed} of ${progress.total} tags done`
        : undefined;

  const progressPercent =
    status === "loading" && progress
      ? allTags
        ? progressToPercent(progress)
        : progress.phase === "done"
          ? 100
          : 50
      : undefined;

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-xs text-gray-800 dark:text-gray-200">
      <div className="font-semibold text-amber-900 dark:text-amber-200">BigQuery snapshot tools</div>
      <SnapshotFreshnessLine
        className="mt-1"
        dataUpdatedAtIso={dataUpdatedAtIso}
        dataUpdatedAtLabel={dataUpdatedAtLabel}
        isStale={isStale}
        hasSnapshotData={hasSnapshotData}
        emptySnapshotHint="(no snapshot — refresh to populate)"
      />
      <p className="mt-1 text-gray-600 dark:text-gray-400 leading-snug">
        Tag dashboards load from JSON on disk — they do not query BigQuery on every request.{" "}
        <strong>Refresh this tag / all tags</strong> (above) or <strong>Rebuild history</strong> here runs a full
        BigQuery pull and overwrites snapshot files. Check <strong>All phone-banking tags</strong> to rebuild every tag
        (same as the violet button above). “Clear first” applies to each tag being rebuilt.
      </p>
      <form onSubmit={onSubmit} className="mt-2 space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allTags}
            onChange={(e) => setAllTags(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span>All phone-banking tags (not only {tagId})</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={clearFirst}
            onChange={(e) => setClearFirst(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span>Delete existing snapshot files first (cold rebuild)</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            placeholder="Snapshot secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="flex-1 min-w-[160px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={status === "loading" || !secret.trim()}
            className="rounded bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white px-3 py-1 text-xs font-medium"
          >
            {status === "loading" ? "Rebuilding…" : allTags ? "Rebuild all tags" : "Rebuild this tag"}
          </button>
        </div>
        {status === "loading" && progressLabel ? (
          <RefreshProgressBar
            percent={progressPercent}
            label={progressLabel}
            detail={progressDetail}
          />
        ) : null}
      </form>
      {status === "ok" && message ? (
        <p className="mt-2 text-emerald-700 dark:text-emerald-400">{message}</p>
      ) : null}
      {status === "err" && message ? (
        <p className="mt-2 text-red-700 dark:text-red-400">{message}</p>
      ) : null}
    </div>
  );
}
