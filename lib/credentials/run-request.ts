import "server-only";

import { getAuthUserFromRequest } from "@/lib/auth/current";
import { accountCredentialContext } from "./account-context";
import { resolveContextFromRequestWithSession } from "./context";
import { runWithCredentialContextAsync } from "./store";

/** Run server work with the signed-in account's server credentials. */
export async function runWithRequestCredentialContext<T>(
  req: Request,
  fn: () => Promise<T>
): Promise<{ result: T; sessionId: string | null }> {
  const user = await getAuthUserFromRequest(req);
  const { ctx: sessionCtx, newSessionId } = resolveContextFromRequestWithSession(req);
  const ctx = user ? accountCredentialContext(sessionCtx) : sessionCtx;
  const sessionId = ctx.scope === "session" ? ctx.sessionId : newSessionId;
  const result = await runWithCredentialContextAsync(ctx, fn);
  return { result, sessionId };
}
