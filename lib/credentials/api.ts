import "server-only";

import { resolveContextFromRequest } from "./context";
import { assertDataAccessAllowed, credentialsRequiredResponse, type DataAccessRequirements } from "./gate";
import { runWithCredentialContextAsync } from "./store";
import type { CredentialContext } from "./types";
import { CredentialsRequiredError } from "./gate";

type RouteHandler = (req: Request, ctx: CredentialContext) => Promise<Response>;

/**
 * Wrap an API route handler with session credential context (AsyncLocalStorage).
 * Optionally enforce that required credentials are configured for this session.
 */
export function withCredentialContext(
  handler: RouteHandler,
  requirements?: DataAccessRequirements
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const ctx = resolveContextFromRequest(req);
    try {
      return await runWithCredentialContextAsync(ctx, async () => {
        if (requirements) {
          assertDataAccessAllowed(requirements);
        }
        return handler(req, ctx);
      });
    } catch (err) {
      if (err instanceof CredentialsRequiredError) {
        return credentialsRequiredResponse(err.message);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ error: message, code: 500 }, { status: 500 });
    }
  };
}
