import { AsyncLocalStorage } from "async_hooks";

export type LiveRefreshProgress = {
  label: string;
  completed: number;
  total: number;
};

type JobStore = Map<string, LiveRefreshProgress>;

function jobs(): JobStore {
  const g = globalThis as typeof globalThis & { __cdRefreshJobs?: JobStore };
  if (!g.__cdRefreshJobs) g.__cdRefreshJobs = new Map();
  return g.__cdRefreshJobs;
}

function currentId(): AsyncLocalStorage<string> {
  const g = globalThis as typeof globalThis & { __cdRefreshAls?: AsyncLocalStorage<string> };
  if (!g.__cdRefreshAls) g.__cdRefreshAls = new AsyncLocalStorage();
  return g.__cdRefreshAls;
}

export function isRefreshProgressId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function readRefreshProgress(id: string): LiveRefreshProgress | null {
  if (!isRefreshProgressId(id)) return null;
  return jobs().get(id) ?? null;
}

/** Keep stage updates on this request so a poll can read them while BigQuery is still running. */
export async function runWithRefreshProgress<T>(
  id: string,
  total: number,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!isRefreshProgressId(id)) return fn();
  jobs().set(id, { label, completed: 0, total: Math.max(1, total) });
  try {
    return await currentId().run(id, fn);
  } finally {
    const prev = jobs().get(id);
    if (prev) jobs().set(id, { ...prev, completed: prev.total, label: "Done" });
    setTimeout(() => jobs().delete(id), 60_000);
  }
}

export function reportRefreshProgress(label: string, completed: number, total?: number): void {
  const id = currentId().getStore();
  if (!id) return;
  const prev = jobs().get(id);
  if (!prev) return;
  jobs().set(id, { label, completed, total: total ?? prev.total });
}
