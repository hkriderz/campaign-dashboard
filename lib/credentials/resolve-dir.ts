import "server-only";

import { PDI_CREDENTIALS_DIR } from "./paths";
import { allowGlobalCredentialFallback, sessionCredentialsEnabled } from "./config";
import { getSessionCredentialsDir } from "./session";
import { getActiveCredentialContext } from "./store";
import type { CredentialContext } from "./types";

/** Directory used by credential resolution for the active or explicit context. */
export function resolveCredentialsDir(ctx?: CredentialContext | null): string {
  if (ctx?.scope === "session" && ctx.sessionId) {
    return ctx.credentialsDir;
  }

  const active = getActiveCredentialContext();
  if (active?.scope === "session" && active.sessionId) {
    return active.credentialsDir;
  }

  if (sessionCredentialsEnabled() && active?.sessionId) {
    return getSessionCredentialsDir(active.sessionId);
  }

  return PDI_CREDENTIALS_DIR;
}

/** Whether env / global folder credentials may be used for the active context. */
export function shouldUseGlobalCredentialFallback(ctx?: CredentialContext | null): boolean {
  if (!sessionCredentialsEnabled()) return true;
  if (!allowGlobalCredentialFallback()) return false;

  const active = ctx ?? getActiveCredentialContext();
  if (!active || active.scope !== "session") return true;
  return false;
}
