import type { SyncLogEvent } from "./logger";
import type { SyncRunSummary } from "./types";

export type SyncRunStatus = "running" | "completed" | "failed";

export type SyncRunRecord = {
  runId: string;
  status: SyncRunStatus;
  events: SyncLogEvent[];
  subscribers: Set<(event: SyncLogEvent) => void>;
  summary: SyncRunSummary | null;
  error: string | null;
  startedAt: string;
};

type RegistryGlobal = {
  __pdiSyncRunRegistry?: Map<string, SyncRunRecord>;
};

function getRegistry(): Map<string, SyncRunRecord> {
  const g = globalThis as RegistryGlobal;
  if (!g.__pdiSyncRunRegistry) {
    g.__pdiSyncRunRegistry = new Map();
  }
  return g.__pdiSyncRunRegistry;
}

export function createSyncRun(runId: string): SyncRunRecord {
  const record: SyncRunRecord = {
    runId,
    status: "running",
    events: [],
    subscribers: new Set(),
    summary: null,
    error: null,
    startedAt: new Date().toISOString(),
  };
  getRegistry().set(runId, record);
  return record;
}

export function getSyncRun(runId: string): SyncRunRecord | undefined {
  return getRegistry().get(runId);
}

export function appendSyncRunEvent(runId: string, event: SyncLogEvent): void {
  const run = getRegistry().get(runId);
  if (!run) return;
  run.events.push(event);
  if (run.events.length > 5000) {
    run.events.splice(0, run.events.length - 5000);
  }
  for (const sub of run.subscribers) {
    try {
      sub(event);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function finishSyncRun(
  runId: string,
  outcome: { status: "completed" | "failed"; summary?: SyncRunSummary; error?: string }
): void {
  const run = getRegistry().get(runId);
  if (!run) return;
  run.status = outcome.status;
  run.summary = outcome.summary ?? null;
  run.error = outcome.error ?? null;
  for (const sub of run.subscribers) {
    run.subscribers.delete(sub);
  }
}

export function subscribeSyncRun(
  runId: string,
  onEvent: (event: SyncLogEvent) => void
): (() => void) | null {
  const run = getRegistry().get(runId);
  if (!run) return null;
  run.subscribers.add(onEvent);
  return () => run.subscribers.delete(onEvent);
}
