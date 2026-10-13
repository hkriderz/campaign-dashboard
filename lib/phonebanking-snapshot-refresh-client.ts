import { qcSyncWaitsForLaterTag } from "@/lib/qc-recontact/refresh-sync";

export type TagRefreshProgress = {
  completed: number;
  total: number;
  currentTagId: string | null;
  currentTagLabel: string | null;
  /** Dialer rows, text campaigns, or phone contacts. */
  stage?: string | null;
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
  refreshed?: string[];
  errors?: { tagId: string; error: string }[];
  stage?: string;
  batchId?: string | null;
  ready?: string[];
  needsFull?: string[];
  historyStart?: string;
  queryStartedAt?: string;
  incremental?: boolean;
  step?: string;
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
  body: {
    tagId?: string;
    clear?: boolean;
    fullRebuild?: boolean;
    refreshAll?: boolean;
    rebuildAllCampaigns?: boolean;
    stage?: "scan" | "apply" | "discard";
    batchId?: string;
    step?: "dialer" | "text" | "contacts";
    historyStart?: string;
    queryStartedAt?: string;
    incremental?: boolean;
    skipQcSync?: boolean;
    progressId?: string;
  }
): Promise<{
  ok: boolean;
  error?: string;
  refreshed?: string[];
  errors?: { tagId: string; error: string }[];
  batchId?: string | null;
  ready?: string[];
  needsFull?: string[];
  historyStart?: string;
  queryStartedAt?: string;
  incremental?: boolean;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) headers["x-snapshot-secret"] = secret;
  const res = await fetch("/api/phonebanking/bq-snapshot-refresh", {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data: RefreshApiResponse = {};
  if (!raw.trim()) {
    return {
      ok: false,
      error: res.ok ? "Refresh returned an empty response." : "Refresh failed before it could finish.",
    };
  }
  try {
    data = JSON.parse(raw) as RefreshApiResponse;
  } catch {
    return {
      ok: false,
      error: res.ok ? "Refresh returned an unreadable response." : "Refresh failed before it could finish.",
    };
  }
  const refreshed = Array.isArray(data.refreshed) ? data.refreshed : undefined;
  const errors = Array.isArray(data.errors) ? data.errors : undefined;
  const ready = Array.isArray(data.ready) ? data.ready : undefined;
  const needsFull = Array.isArray(data.needsFull) ? data.needsFull : undefined;
  const batchId = typeof data.batchId === "string" ? data.batchId : data.batchId === null ? null : undefined;
  const historyStart = typeof data.historyStart === "string" ? data.historyStart : undefined;
  const queryStartedAt = typeof data.queryStartedAt === "string" ? data.queryStartedAt : undefined;
  const incremental = typeof data.incremental === "boolean" ? data.incremental : undefined;
  if (!res.ok) {
    return {
      ok: false,
      error: data.error ?? data.message ?? "Refresh failed",
      refreshed,
      errors,
      batchId,
      ready,
      needsFull,
      historyStart,
      queryStartedAt,
      incremental,
    };
  }
  return { ok: true, refreshed, errors, batchId, ready, needsFull, historyStart, queryStartedAt, incremental };
}

function watchRefreshProgress(
  secret: string,
  progressId: string,
  onUpdate: (live: { label: string; completed: number; total: number }) => void
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const headers: Record<string, string> = {};
      if (secret) headers["x-snapshot-secret"] = secret;
      const res = await fetch(
        `/api/phonebanking/bq-snapshot-refresh?progressId=${encodeURIComponent(progressId)}`,
        { cache: "no-store", credentials: "same-origin", headers }
      );
      const data = (await res.json()) as { label?: string; completed?: number; total?: number };
      if (stopped || typeof data.completed !== "number" || !(data.total && data.total > 0)) return;
      onUpdate({
        label: typeof data.label === "string" ? data.label : "",
        completed: data.completed,
        total: data.total,
      });
    } catch {
      /* the refresh request is still running */
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 800);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** One request: dialer, text, and phone contacts, then the watermark. */
export async function refreshOnePhonebankingTag(
  secret: string,
  tagId: string,
  fullRebuild = false,
  onProgress?: (progress: TagRefreshProgress) => void
): Promise<void> {
  const progressId = crypto.randomUUID();
  const publish = (completed: number, total: number, stage: string, phase: TagRefreshProgress["phase"]) => {
    onProgress?.({
      completed,
      total,
      currentTagId: phase === "done" ? null : tagId,
      currentTagLabel: phase === "done" ? null : tagId,
      stage: phase === "done" ? null : stage,
      phase,
    });
  };
  publish(0, 3, "Dialer rows", "refreshing");
  const stop = watchRefreshProgress(secret, progressId, (live) => {
    publish(live.completed, live.total, live.label, "refreshing");
  });
  try {
    const result = await postTagSnapshotRefresh(secret, { tagId, fullRebuild, progressId });
    if (!result.ok) throw new Error(result.error ?? "Refresh failed");
    publish(3, 3, "", "done");
  } finally {
    stop();
  }
}

/**
 * One shared dialer scan, then one request per tag.
 * That request finishes the tag, including the watermark, before the bar moves on.
 * Tags without a snapshot are rebuilt on their own.
 */
export async function refreshAllPhonebankingTags(
  secret: string,
  onProgress?: (progress: TagRefreshProgress) => void
): Promise<SequentialRefreshResult> {
  const tags = await fetchActivePhonebankingTags();
  const labels = new Map(tags.map((tag) => [tag.id, tag.label]));
  onProgress?.({
    completed: 0,
    total: tags.length,
    currentTagId: null,
    currentTagLabel: null,
    phase: "loading-tags",
  });

  const scanId = crypto.randomUUID();
  const stopScan = watchRefreshProgress(secret, scanId, (live) => {
    onProgress?.({
      completed: 0,
      total: tags.length,
      currentTagId: null,
      currentTagLabel: null,
      stage: live.label || "Scanning dialer tables",
      phase: "loading-tags",
    });
  });
  const scan = await postTagSnapshotRefresh(secret, { refreshAll: true, stage: "scan", progressId: scanId });
  stopScan();
  if (!scan.ok) {
    throw new Error(scan.error ?? "Dialer scan failed");
  }

  const ready = new Set(scan.ready ?? []);
  const order = [...(scan.ready ?? []), ...(scan.needsFull ?? [])];
  const refreshed: string[] = [];
  const errors: { tagId: string; error: string }[] = [];

  try {
    for (let i = 0; i < order.length; i++) {
      const tagId = order[i]!;
      const tagLabel = labels.get(tagId) ?? tagId;
      const tagTotal = order.length * 3;
      const progressId = crypto.randomUUID();
      onProgress?.({
        completed: i * 3,
        total: tagTotal,
        currentTagId: tagId,
        currentTagLabel: tagLabel,
        stage: "Dialer rows",
        phase: "refreshing",
      });
      const stop = watchRefreshProgress(secret, progressId, (live) => {
        onProgress?.({
          completed: i * 3 + live.completed,
          total: tagTotal,
          currentTagId: tagId,
          currentTagLabel: tagLabel,
          stage: live.label,
          phase: "refreshing",
        });
      });
      const skipQcSync = qcSyncWaitsForLaterTag(tagId, order.slice(i + 1));
      const result = ready.has(tagId)
        ? await postTagSnapshotRefresh(secret, {
            refreshAll: true,
            stage: "apply",
            batchId: scan.batchId ?? undefined,
            tagId,
            progressId,
            skipQcSync,
          })
        : await postTagSnapshotRefresh(secret, { tagId, fullRebuild: true, progressId, skipQcSync });
      stop();
      if (result.ok) refreshed.push(tagId);
      else errors.push({ tagId, error: result.error ?? "Refresh failed" });
    }
  } finally {
    if (scan.batchId) {
      await postTagSnapshotRefresh(secret, { refreshAll: true, stage: "discard", batchId: scan.batchId });
    }
  }

  if (refreshed.length === 0 && errors.length > 0) {
    throw new Error(errors.map((entry) => `${entry.tagId}: ${entry.error}`).join("; "));
  }

  onProgress?.({
    completed: order.length,
    total: order.length,
    currentTagId: null,
    currentTagLabel: null,
    phase: "done",
  });
  return { refreshed, errors };
}

/**
 * Rebuild snapshots tag-by-tag so the UI can show per-tag progress (same work as refreshAll).
 */
export async function refreshPhonebankingTagsSequential(options: {
  tagIds: string[];
  tagLabels?: Map<string, string>;
  secret: string;
  clearFirst?: boolean;
  fullRebuild?: boolean;
  onProgress: (progress: TagRefreshProgress) => void;
}): Promise<SequentialRefreshResult> {
  const { tagIds, tagLabels, secret, clearFirst = false, fullRebuild = false, onProgress } = options;
  const total = tagIds.length;
  const refreshed: string[] = [];
  const errors: { tagId: string; error: string }[] = [];

  for (let i = 0; i < total; i++) {
    const tagId = tagIds[i]!;
    const tagLabel = tagLabels?.get(tagId) ?? tagId;
    const progressId = crypto.randomUUID();
    onProgress({
      completed: i * 3,
      total: total * 3,
      currentTagId: tagId,
      currentTagLabel: tagLabel,
      stage: "Dialer rows",
      phase: "refreshing",
    });
    const stop = watchRefreshProgress(secret, progressId, (live) => {
      onProgress({
        completed: i * 3 + live.completed,
        total: total * 3,
        currentTagId: tagId,
        currentTagLabel: tagLabel,
        stage: live.label,
        phase: "refreshing",
      });
    });

    const result = await postTagSnapshotRefresh(secret, {
      tagId,
      clear: clearFirst,
      fullRebuild: fullRebuild || clearFirst,
      progressId,
    });
    stop();

    if (result.ok) {
      refreshed.push(tagId);
    } else {
      errors.push({ tagId, error: result.error ?? "Unknown error" });
    }
  }

  onProgress({
    completed: total * 3,
    total: total * 3,
    currentTagId: null,
    currentTagLabel: null,
    stage: null,
    phase: "done",
  });

  return { refreshed, errors };
}

export async function rebuildAllCampaignsSnapshotRequest(secret: string): Promise<{ ok: boolean; error?: string }> {
  return postTagSnapshotRefresh(secret, { rebuildAllCampaigns: true });
}

export function progressToPercent(progress: TagRefreshProgress): number {
  if (progress.phase === "done") return 100;
  if (progress.total <= 0) return 0;
  if (progress.phase === "loading-tags") return 0;
  // While refreshing tag i (0-based), show partial fill through completed count
  const base = progress.completed / progress.total;
  const inFlight = progress.currentTagId ? 0.5 / progress.total : 0;
  return Math.min(99, Math.round((base + inFlight) * 100));
}
