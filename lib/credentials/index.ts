/**
 * Server-only credential session utilities.
 * Import from `@/lib/credentials` in app code; middleware uses `@/lib/credentials/config` + `session-id` directly.
 */
import "server-only";

export {
  sessionCredentialsEnabled,
  allowGlobalCredentialFallback,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SEC,
  SESSION_REQUEST_HEADER,
  sessionCredentialsTtlHours,
} from "./config";
export type { CredentialContext, CredentialScope } from "./types";
export {
  createSessionId,
  isValidSessionId,
} from "./session-id";
export {
  getSessionCredentialsDir,
  ensureSessionCredentialsDir,
  touchSessionMeta,
  pruneStaleSessionCredentials,
  SESSIONS_ROOT,
} from "./session";
export {
  getActiveCredentialContext,
  runWithCredentialContext,
  runWithCredentialContextAsync,
} from "./store";
export {
  resolveContextFromCookies,
  resolveContextFromRequest,
  issueNewSessionId,
  credentialsDirLabel,
} from "./context";
export {
  resolveCredentialsDir,
  shouldUseGlobalCredentialFallback,
} from "./resolve-dir";
export {
  CredentialsRequiredError,
  getCredentialStatus,
  isGcpConfigured,
  isPdiConfigured,
  meetsDataAccessRequirements,
  assertDataAccessAllowed,
  credentialsRequiredResponse,
  type DataAccessRequirements,
} from "./gate";
export { withCredentialContext } from "./api";
export { runServerWithCredentialContext } from "./server";
export { PDI_CREDENTIALS_DIR } from "./paths";
