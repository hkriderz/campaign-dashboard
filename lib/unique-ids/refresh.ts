import "server-only";

import { getCoreCampaignTags, getTagById } from "../campaign-tags";
import { snapshotsDisabled } from "../bq-snapshot-store";
import {
  rebuildPhoneUniqueIdSnapshot,
  rebuildTextUniqueIdSnapshot,
} from "../queries/unique-id-contacts";

export type UniqueIdSnapshotRefreshResult =
  | {
      ok: true;
      refreshAll: boolean;
      refreshed: string[];
      errors: { tagId: string; error: string }[];
    }
  | { ok: true; tagId: string }
  | {
      ok: false;
      status: number;
      error: string;
      refreshed?: string[];
      errors?: { tagId: string; error: string }[];
    };

async function rebuildTagUniqueIdSnapshots(tagId: string): Promise<void> {
  const tag = getTagById(tagId);
  if (!tag || tag.id.startsWith("qc-")) {
    throw new Error("Unknown or QC candidate tag.");
  }
  const [phone, text] = await Promise.all([
    rebuildPhoneUniqueIdSnapshot(tag),
    rebuildTextUniqueIdSnapshot(tag),
  ]);
  const errors = [phone.error, text.error].filter((item): item is string => Boolean(item));
  if (errors.length) {
    throw new Error(errors.join(" "));
  }
}

export async function runUniqueIdSnapshotRefresh(args: {
  refreshAll?: boolean;
  tagId?: string;
}): Promise<UniqueIdSnapshotRefreshResult> {
  if (snapshotsDisabled()) {
    return {
      ok: false,
      status: 400,
      error: "Snapshots are disabled (BQ_SNAPSHOTS_DISABLED=1).",
    };
  }

  if (args.refreshAll === true) {
    const refreshed: string[] = [];
    const errors: { tagId: string; error: string }[] = [];
    for (const tag of getCoreCampaignTags()) {
      try {
        await rebuildTagUniqueIdSnapshots(tag.id);
        refreshed.push(tag.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ tagId: tag.id, error: message });
      }
    }
    if (refreshed.length === 0 && errors.length > 0) {
      return {
        ok: false,
        status: 500,
        error: "Every candidate rebuild failed.",
        refreshed,
        errors,
      };
    }
    return { ok: true, refreshAll: true, refreshed, errors };
  }

  const tagId = typeof args.tagId === "string" ? args.tagId.trim() : "";
  if (!tagId || !getTagById(tagId) || tagId.startsWith("qc-")) {
    return {
      ok: false,
      status: 400,
      error: "Unknown or missing tagId (or set refreshAll: true).",
    };
  }

  try {
    await rebuildTagUniqueIdSnapshots(tagId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: message };
  }

  return { ok: true, tagId };
}
