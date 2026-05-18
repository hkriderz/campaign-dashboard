import { getPhonebankingTags, getTagById } from "@/lib/campaign-tags";
import { clearTagSnapshots, snapshotsDisabled } from "@/lib/bq-snapshot-store";
import { revalidatePhonebankingTagDataCaches } from "@/lib/phonebanking-data-cache";
import { rebuildTagBqSnapshotsFromBigQuery } from "@/lib/queries/phonebanking";

export type SnapshotRefreshResult =
  | {
      ok: true;
      refreshAll: boolean;
      refreshed: string[];
      errors: { tagId: string; error: string }[];
    }
  | { ok: true; tagId: string }
  | { ok: false; status: number; error: string; refreshed?: string[]; errors?: { tagId: string; error: string }[] };

/**
 * Rebuild on-disk BQ snapshots for one tag or all phone-banking tags (including derived QC slugs).
 */
export async function runPhonebankingBqSnapshotRefresh(args: {
  refreshAll?: boolean;
  tagId?: string;
  clearFirst?: boolean;
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

  if (refreshAll) {
    const refreshed: string[] = [];
    const errors: { tagId: string; error: string }[] = [];

    for (const t of getPhonebankingTags()) {
      if (clearFirst) {
        clearTagSnapshots(t.id);
      }
      try {
        await rebuildTagBqSnapshotsFromBigQuery(t.id);
        revalidatePhonebankingTagDataCaches(t.id);
        refreshed.push(t.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ tagId: t.id, error: message });
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
    await rebuildTagBqSnapshotsFromBigQuery(tagId);
    revalidatePhonebankingTagDataCaches(tagId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: message };
  }

  return { ok: true, tagId };
}
