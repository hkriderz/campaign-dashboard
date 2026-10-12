import "server-only";

import { getCredentialStatus } from "./gate";
import { serverCredentialContext } from "./context";
import { sessionCredentialsEnabled } from "./config";
import type { CredentialContext } from "./types";

/**
 * Logged-in requests use the server credential files when those files are configured.
 * When the server folder has no GCP or PDI keys, the browser session folder is used
 * so an upload can still unlock that browser. Uploads themselves stay in the session folder.
 */
export function accountCredentialContext(sessionCtx: CredentialContext): CredentialContext {
  if (!sessionCredentialsEnabled()) return serverCredentialContext();
  const server = serverCredentialContext();
  const status = getCredentialStatus(server);
  if (status.gcp.configured || status.pdi.configured) return server;
  return sessionCtx.scope === "session" ? sessionCtx : server;
}
