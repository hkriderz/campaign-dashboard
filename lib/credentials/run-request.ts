import "server-only";

import { getAuthUserFromRequest } from "@/lib/auth/current";
import { resolveContextFromRequestWithSession, serverCredentialContext } from "./context";
import { runWithCredentialContextAsync } from "./store";

/** Run server work with the signed-in account's server credentials. */
export async function runWithRequestCredentialContext<T>(
  req: Request,
  fn: () => Promise<T>
): Promise<{ result: T; sessionId: string | null }> {
  const user = await getAuthUserFromRequest(req);
  if (user) {
    const result = await runWithCredentialContextAsync(serverCredentialContext(), fn);
    return { result, sessionId: null };
  }
  const { ctx, newSessionId } = resolveContextFromRequestWithSession(req);
  const sessionId = ctx.scope === "session" ? ctx.sessionId : newSessionId;
  const result = await runWithCredentialContextAsync(ctx, fn);
  return { result, sessionId };
}
