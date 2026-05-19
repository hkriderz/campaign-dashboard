import "server-only";

import { resolveContextFromRequestWithSession } from "./context";
import { runWithCredentialContextAsync } from "./store";

/** Run server work with the browser session from this request (cookie / middleware header). */
export async function runWithRequestCredentialContext<T>(
  req: Request,
  fn: () => Promise<T>
): Promise<{ result: T; sessionId: string | null }> {
  const { ctx, newSessionId } = resolveContextFromRequestWithSession(req);
  const sessionId = ctx.scope === "session" ? ctx.sessionId : newSessionId;
  const result = await runWithCredentialContextAsync(ctx, fn);
  return { result, sessionId };
}
