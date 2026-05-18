export type TagRefreshProgress = {
  completed: number;
  total: number;
  currentTagId: string | null;
  currentTagLabel: string | null;
  phase: "loading-tags" | "refreshing" | "done";
};

export type SequentialRefreshResult = {
  refreshed: string[];
  errors: { tagId: string; error: string }[];
};

type RefreshApiResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export async function fetchActivePhonebankingTags(): Promise<
  { id: string; label: string }[]
> {
  const res = await fetch("/api/campaign-tags", { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as {
    activePhonebankingTags?: { id: string; label: string }[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? res.statusText);
  }
  return data.activePhonebankingTags ?? [];
}

async function postTagSnapshotRefresh(
  secret: string,
  body: { tagId: string; clear?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/phonebanking/bq-snapshot-refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-snapshot-secret": secret,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as RefreshApiResponse;
  if (!res.ok) {
    return { ok: false, error: data.error ?? data.message ?? res.statusText };
  }
  return { ok: true };
}

/**
 * Rebuild snapshots tag-by-tag so the UI can show per-tag progress (same work as refreshAll).
 */
export async function refreshPhonebankingTagsSequential(options: {
  tagIds: string[];
  tagLabels?: Map<string, string>;
  secret: string;
  clearFirst?: boolean;
  onProgress: (progress: TagRefreshProgress) => void;
}): Promise<SequentialRefreshResult> {
  const { tagIds, tagLabels, secret, clearFirst = false, onProgress } = options;
  const total = tagIds.length;
  const refreshed: string[] = [];
  const errors: { tagId: string; error: string }[] = [];

  for (let i = 0; i < total; i++) {
    const tagId = tagIds[i]!;
    onProgress({
      completed: i,
      total,
      currentTagId: tagId,
      currentTagLabel: tagLabels?.get(tagId) ?? tagId,
      phase: "refreshing",
    });

    const result = await postTagSnapshotRefresh(secret, {
      tagId,
      clear: clearFirst,
    });

    if (result.ok) {
      refreshed.push(tagId);
    } else {
      errors.push({ tagId, error: result.error ?? "Unknown error" });
    }
  }

  onProgress({
    completed: total,
    total,
    currentTagId: null,
    currentTagLabel: null,
    phase: "done",
  });

  return { refreshed, errors };
}

export function progressToPercent(progress: TagRefreshProgress): number {
  if (progress.total <= 0) return 0;
  if (progress.phase === "done") return 100;
  if (progress.phase === "loading-tags") return 0;
  // While refreshing tag i (0-based), show partial fill through completed count
  const base = progress.completed / progress.total;
  const inFlight = progress.currentTagId ? 0.5 / progress.total : 0;
  return Math.min(99, Math.round((base + inFlight) * 100));
}
