import { getPhonebankingTags, getTagById } from "@/lib/campaign-tags";
import { clearTagSnapshots, snapshotsDisabled } from "@/lib/bq-snapshot-store";
import { revalidatePhonebankingTagDataCaches } from "@/lib/phonebanking-data-cache";
import {
  applySharedDialerRefresh,
  beginTagSnapshotRefresh,
  discardSharedDialerRefresh,
  rebuildAllCampaignsSnapshot,
  rebuildTagBqSnapshotsFromBigQuery,
  refreshTagContactsStep,
  refreshTagTextStep,
  refreshTagsFromSharedDialerScan,
  startSharedDialerRefresh,
  type TagSnapshotRefreshMode,
} from "@/lib/queries/phonebanking";
import { qcSyncWaitsForLaterTag } from "@/lib/qc-recontact/refresh-sync";
import { isValidIsoDate } from "@/lib/validation/iso-date";

export type SnapshotRefreshResult =
  | {
      ok: true;
      refreshAll: boolean;
      refreshed: string[];
      errors: { tagId: string; error: string }[];
    }
  | { ok: true; tagId: string }
  | { ok: true; stage: "scan"; batchId: string | null; ready: string[]; needsFull: string[] }
  | { ok: true; stage: "apply"; tagId: string; historyStart: string; queryStartedAt: string; incremental: boolean }
  | { ok: true; stage: "discard" }
  | { ok: true; step: "dialer"; tagId: string; historyStart: string; queryStartedAt: string; incremental: boolean }
  | { ok: true; step: "text" | "contacts"; tagId: string }
  | { ok: false; status: number; error: string; refreshed?: string[]; errors?: { tagId: string; error: string }[] };

/**
 * Rebuild on-disk BQ snapshots for one tag or all phone-banking tags (including derived QC slugs).
 */
export async function runPhonebankingBqSnapshotRefresh(args: {
  refreshAll?: boolean;
  tagId?: string;
  clearFirst?: boolean;
  /** True reloads history since 2025-12-01. False reads since the last query start, minus one Pacific day. */
  fullRebuild?: boolean;
  /** Rewrite only the unfiltered all-campaigns snapshot. */
  rebuildAllCampaigns?: boolean;
  /** Split a refresh-all into a shared scan, then one tag at a time, so the UI can move. */
  stage?: "scan" | "apply" | "discard";
  batchId?: string;
  /** One slice of a tag refresh, so the progress bar can move before the slow phone-contact query. */
  step?: "dialer" | "text" | "contacts";
  historyStart?: string;
  queryStartedAt?: string;
  incremental?: boolean;
  /** Skip this tag's QC pair rebuild because its counterpart is refreshed later in the batch. */
  skipQcSync?: boolean;
}): Promise<SnapshotRefreshResult> {
  if (snapshotsDisabled()) {
    return {
      ok: false,
      status: 400,
      error: "Snapshots are disabled (BQ_SNAPSHOTS_DISABLED=1).",
    };
  }

  const refreshAll = args.refreshAll === true;
  const clearFirst = args.clearFirst === true;
  const mode: TagSnapshotRefreshMode = args.fullRebuild === true || clearFirst ? "full" : "incremental";

  if (args.stage === "scan") {
    try {
      const scan = await startSharedDialerRefresh(getPhonebankingTags().map((tag) => tag.id));
      return { ok: true, stage: "scan", batchId: scan.batchId, ready: scan.ready, needsFull: scan.needsFull };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 500, error: message };
    }
  }

  if (args.stage === "discard") {
    const batchId = args.batchId ?? "";
    try {
      if (batchId) discardSharedDialerRefresh(batchId);
      return { ok: true, stage: "discard" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: message };
    }
  }

  if (args.stage === "apply") {
    const tagId = typeof args.tagId === "string" ? args.tagId : "";
    const batchId = args.batchId ?? "";
    if (!tagId || !getTagById(tagId) || !batchId) {
      return { ok: false, status: 400, error: "Refresh apply needs a tagId and batchId." };
    }
    try {
      const window = await applySharedDialerRefresh(batchId, tagId, {
        followUps: args.step !== "dialer",
        skipQcSync: args.skipQcSync === true,
      });
      if (args.step === "dialer") {
        return { ok: true, stage: "apply", tagId, ...window };
      }
      revalidatePhonebankingTagDataCaches(tagId);
      return { ok: true, stage: "apply", tagId, ...window };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 500, error: message };
    }
  }

  if (args.step === "dialer" || args.step === "text" || args.step === "contacts") {
    const tagId = typeof args.tagId === "string" ? args.tagId : "";
    if (!tagId || !getTagById(tagId)) {
      return { ok: false, status: 400, error: "Unknown or missing tagId." };
    }
    try {
      if (args.step === "dialer") {
        const window = await beginTagSnapshotRefresh(tagId, mode);
        return { ok: true, step: "dialer", tagId, ...window };
      }
      const historyStart = args.historyStart ?? "";
      const queryStartedAt = args.queryStartedAt ?? "";
      if (!isValidIsoDate(historyStart) || Number.isNaN(Date.parse(queryStartedAt))) {
        return { ok: false, status: 400, error: "Text and contact steps need historyStart and queryStartedAt." };
      }
      const window = {
        historyStart,
        queryStartedAt,
        incremental: args.incremental === true,
      };
      if (args.step === "text") await refreshTagTextStep(tagId, window);
      else await refreshTagContactsStep(tagId, window);
      revalidatePhonebankingTagDataCaches(tagId);
      return { ok: true, step: args.step, tagId };
    } catch (err) {
      console.error("[bq-snapshot-refresh]", args.step, tagId, err);
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
      return {
        ok: false,
        status: 500,
        error: cause && !message.includes(cause) ? `${message}: ${cause}` : message || "Refresh failed",
      };
    }
  }

  if (args.rebuildAllCampaigns === true) {
    try {
      await rebuildAllCampaignsSnapshot();
      return { ok: true, tagId: "all-campaigns" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 500, error: message };
    }
  }

  if (refreshAll) {
    const refreshed: string[] = [];
    const errors: { tagId: string; error: string }[] = [];
    const tags = getPhonebankingTags();

    if (mode === "incremental") {
      const shared = await refreshTagsFromSharedDialerScan(tags.map((tag) => tag.id));
      for (const tagId of shared.refreshed) {
        revalidatePhonebankingTagDataCaches(tagId);
        refreshed.push(tagId);
      }
      errors.push(...shared.errors);
      for (let i = 0; i < shared.needsFull.length; i++) {
        const tagId = shared.needsFull[i]!;
        try {
          await rebuildTagBqSnapshotsFromBigQuery(tagId, {
            mode: "full",
            skipQcSync: qcSyncWaitsForLaterTag(tagId, shared.needsFull.slice(i + 1)),
          });
          revalidatePhonebankingTagDataCaches(tagId);
          refreshed.push(tagId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ tagId, error: message });
        }
      }
    } else {
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i]!;
        if (clearFirst) {
          clearTagSnapshots(t.id);
        }
        try {
          await rebuildTagBqSnapshotsFromBigQuery(t.id, {
            mode,
            skipQcSync: qcSyncWaitsForLaterTag(t.id, tags.slice(i + 1).map((tag) => tag.id)),
          });
          revalidatePhonebankingTagDataCaches(t.id);
          refreshed.push(t.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ tagId: t.id, error: message });
        }
      }
    }

    if (refreshed.length === 0 && errors.length > 0) {
      return {
        ok: false,
        status: 500,
        error: "Every tag rebuild failed.",
        refreshed,
        errors,
      };
    }

    return { ok: true, refreshAll: true, refreshed, errors };
  }

  const tagId = typeof args.tagId === "string" ? args.tagId : "";
  if (!tagId || !getTagById(tagId)) {
    return {
      ok: false,
      status: 400,
      error: "Unknown or missing tagId (or set refreshAll: true).",
    };
  }

  if (clearFirst) {
    clearTagSnapshots(tagId);
  }

  try {
    await rebuildTagBqSnapshotsFromBigQuery(tagId, { mode, skipQcSync: args.skipQcSync === true });
    revalidatePhonebankingTagDataCaches(tagId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: message };
  }

  return { ok: true, tagId };
}
