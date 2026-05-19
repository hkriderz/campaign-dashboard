import "server-only";

import { resolveContextFromCookies } from "./context";
import { runWithCredentialContextAsync } from "./store";

/** Run a server component / RSC data fetch with the browser session credential context. */
export async function runServerWithCredentialContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = await resolveContextFromCookies();
  return runWithCredentialContextAsync(ctx, fn);
}
