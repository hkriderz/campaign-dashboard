import "server-only";

import { getAuthUserFromCookies } from "@/lib/auth/current";
import { resolveContextFromCookies, serverCredentialContext } from "./context";
import { runWithCredentialContextAsync } from "./store";

/** Run a server component / RSC data fetch with the signed-in account's server credentials. */
export async function runServerWithCredentialContext<T>(fn: () => Promise<T>): Promise<T> {
  const user = await getAuthUserFromCookies();
  const ctx = user ? serverCredentialContext() : await resolveContextFromCookies();
  return runWithCredentialContextAsync(ctx, fn);
}
