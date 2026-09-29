"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import RefreshProgressBar from "@/components/shared/RefreshProgressBar";
import SnapshotFreshnessLine from "@/components/phonebanking/SnapshotFreshnessLine";
import {
  fetchActivePhonebankingTags,
  progressToPercent,
  rebuildAllCampaignsSnapshotRequest,
  refreshPhonebankingTagsSequential,
  type TagRefreshProgress,
} from "@/lib/phonebanking-snapshot-refresh-client";

/**
 * All campaigns section: refresh or rebuild every campaign tag, or rebuild the unfiltered campaign list.
 */
export default function AllCampaignsSnapshotActions({
  enabled,
  localDev = false,
  dataUpdatedAtIso,
  dataUpdatedAtLabel,
  isStale,
  hasSnapshotData,
}: {
  enabled: boolean;
  localDev?: boolean;
  dataUpdatedAtIso?: string | null;
  dataUpdatedAtLabel?: string;
  isStale?: boolean;
  hasSnapshotData?: boolean;
}) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState<null | "refreshTags" | "rebuildTags" | "rebuildAll">(null);
  const [progress, setProgress] = useState<TagRefreshProgress | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "warn" | "err">("ok");

  async function runTags(fullRebuild: boolean) {
    if (!localDev && !secret.trim()) return;
    setLoading(fullRebuild ? "rebuildTags" : "refreshTags");
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
      const { refreshed, errors } = await refreshPhonebankingTagsSequential({
        tagIds: tags.map((tag) => tag.id),
        tagLabels: new Map(tags.map((tag) => [tag.id, tag.label])),
        secret: secret.trim(),
        clearFirst: false,
        fullRebuild,
        onProgress: setProgress,
      });
      if (refreshed.length === 0 && errors.length > 0) {
        setMessageTone("err");
        setMessage(`Every tag failed: ${errors.map((e) => `${e.tagId}: ${e.error}`).join("; ")}`);
      } else if (errors.length > 0) {
        setMessageTone("warn");
        setMessage(
          `Updated ${refreshed.length} tag(s). ${errors.length} failed: ${errors.map((e) => `${e.tagId}: ${e.error}`).join("; ")}`
        );
      } else if (tags.length === 0) {
        setMessageTone("warn");
        setMessage("No phone-banking tags to update.");
      } else {
        setMessageTone("ok");
        setMessage(
          fullRebuild
            ? `Rebuilt all ${refreshed.length} campaign tag(s) since Dec 1, 2025.`
            : `Refreshed the last three Pacific days for ${refreshed.length} campaign tag(s).`
        );
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

  async function onRebuildAll() {
    if (!localDev && !secret.trim()) return;
    setLoading("rebuildAll");
    setMessage("");
    setProgress(null);
    try {
      const result = await rebuildAllCampaignsSnapshotRequest(localDev ? secret.trim() : secret.trim());
      if (!result.ok) {
        setMessageTone("err");
        setMessage(result.error ?? "Rebuild all failed");
        return;
      }
      setMessageTone("ok");
      setMessage("Rebuilt the full campaign list since Dec 1, 2025.");
      router.refresh();
    } catch (err) {
      setMessageTone("err");
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  if (!enabled && !localDev) {
    return (
      <SnapshotFreshnessLine
        dataUpdatedAtIso={dataUpdatedAtIso}
        dataUpdatedAtLabel={dataUpdatedAtLabel}
        isStale={isStale}
        hasSnapshotData={hasSnapshotData}
        emptySnapshotHint="(no all-campaigns snapshot — use Rebuild all after the snapshot secret is set)"
      />
    );
  }

  const busy = loading !== null;
  const progressLabel =
    loading === "rebuildAll"
      ? "Rebuilding all campaigns"
      : progress?.phase === "loading-tags"
        ? "Loading tag list…"
        : progress?.phase === "done"
          ? "Update complete"
          : loading === "rebuildTags"
            ? "Rebuilding all tags"
            : loading === "refreshTags"
              ? "Refreshing all tags"
              : "";

  return (
    <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40 px-3 py-2 space-y-2">
      <SnapshotFreshnessLine
        dataUpdatedAtIso={dataUpdatedAtIso}
        dataUpdatedAtLabel={dataUpdatedAtLabel}
        isStale={isStale}
        hasSnapshotData={hasSnapshotData}
        emptySnapshotHint="(no snapshot yet — Rebuild all loads every campaign)"
      />
      <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-snug">
        <strong>Refresh all tags</strong> merges the last three Pacific days for every tag in campaign tags.{" "}
        <strong>Rebuild all tags</strong> reloads those tags since Dec 1, 2025. <strong>Rebuild all</strong> reloads
        the unfiltered campaign list, including campaigns that match no tag.
      </p>
      {localDev ? null : (
        <input
          type="password"
          autoComplete="off"
          aria-label="Snapshot secret"
          placeholder="Secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="w-full sm:w-40 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
        />
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runTags(false)}
          disabled={busy || (!localDev && !secret.trim())}
          className="rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 min-h-10 text-xs font-medium"
        >
          {loading === "refreshTags" ? "Refreshing tags…" : "Refresh all tags"}
        </button>
        <button
          type="button"
          onClick={() => void runTags(true)}
          disabled={busy || (!localDev && !secret.trim())}
          className="rounded bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white px-3 py-2 min-h-10 text-xs font-medium"
        >
          {loading === "rebuildTags" ? "Rebuilding tags…" : "Rebuild all tags"}
        </button>
        <button
          type="button"
          onClick={() => void onRebuildAll()}
          disabled={busy || (!localDev && !secret.trim())}
          className="rounded bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white px-3 py-2 min-h-10 text-xs font-medium"
        >
          {loading === "rebuildAll" ? "Rebuilding…" : "Rebuild all"}
        </button>
      </div>
      {busy && progressLabel && loading !== "rebuildAll" ? (
        <RefreshProgressBar
          percent={progress ? progressToPercent(progress) : undefined}
          label={progressLabel}
          detail={
            progress?.currentTagLabel && progress.phase === "refreshing"
              ? `${progress.completed + 1} of ${progress.total} — ${progress.currentTagLabel}`
              : undefined
          }
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
