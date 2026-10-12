import "server-only";

import { getAuthUserFromCookies } from "@/lib/auth/current";
import { accountCredentialContext } from "./account-context";
import { resolveContextFromCookies } from "./context";
import { runWithCredentialContextAsync } from "./store";

/** Run a server component / RSC data fetch with the signed-in account's server credentials. */
export async function runServerWithCredentialContext<T>(fn: () => Promise<T>): Promise<T> {
  const user = await getAuthUserFromCookies();
  const sessionCtx = await resolveContextFromCookies();
  const ctx = user ? accountCredentialContext(sessionCtx) : sessionCtx;
  return runWithCredentialContextAsync(ctx, fn);
}
