import "server-only";

import { AsyncLocalStorage } from "async_hooks";
import type { CredentialContext } from "./types";

const storage = new AsyncLocalStorage<CredentialContext>();

/** Active credential context for the current async execution (API route, server action, sync job). */
export function getActiveCredentialContext(): CredentialContext | undefined {
  return storage.getStore();
}

export function runWithCredentialContext<T>(ctx: CredentialContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function runWithCredentialContextAsync<T>(
  ctx: CredentialContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(ctx, fn);
}
