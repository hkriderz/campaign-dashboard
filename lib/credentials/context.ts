import "server-only";

import path from "path";
import { cookies, headers } from "next/headers";
import { PDI_CREDENTIALS_DIR } from "./paths";
import {
  SESSION_COOKIE_NAME,
  SESSION_REQUEST_HEADER,
  sessionCredentialsEnabled,
} from "./config";
import {
  createSessionId,
  ensureSessionCredentialsDir,
  getSessionCredentialsDir,
  isValidSessionId,
} from "./session";
import type { CredentialContext } from "./types";

function globalContext(): CredentialContext {
  return {
    scope: "global",
    sessionId: null,
    credentialsDir: PDI_CREDENTIALS_DIR,
  };
}

function sessionContext(sessionId: string): CredentialContext {
  return {
    scope: "session",
    sessionId,
    credentialsDir: getSessionCredentialsDir(sessionId),
  };
}

/** Resolve context from Next.js server `cookies()` (RSC / route handlers). */
export async function resolveContextFromCookies(): Promise<CredentialContext> {
  if (!sessionCredentialsEnabled()) {
    return globalContext();
  }

  const cookieStore = await cookies();
  let raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionId(raw)) {
    const hdrs = await headers();
    raw = hdrs.get(SESSION_REQUEST_HEADER) ?? undefined;
  }

  if (!isValidSessionId(raw)) {
    return globalContext();
  }

  ensureSessionCredentialsDir(raw);
  return sessionContext(raw);
}

/** Resolve context from a `Request` (API routes). */
export function resolveContextFromRequest(req: Request): CredentialContext {
  return resolveContextFromRequestWithSession(req).ctx;
}

export type RequestCredentialResolution = {
  ctx: CredentialContext;
  /** Set on the response when a new browser session was created for this request. */
  newSessionId: string | null;
};

/**
 * When session mode is on, always resolve to a session directory (never global).
 * Creates a new session id if the cookie/header is missing (e.g. first API call before middleware cookie is stored).
 */
export function resolveContextFromRequestWithSession(req: Request): RequestCredentialResolution {
  if (!sessionCredentialsEnabled()) {
    return { ctx: globalContext(), newSessionId: null };
  }

  const headerSession = req.headers.get(SESSION_REQUEST_HEADER);
  if (isValidSessionId(headerSession)) {
    ensureSessionCredentialsDir(headerSession);
    return { ctx: sessionContext(headerSession), newSessionId: null };
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`)
  );
  const raw = match?.[1] ? decodeURIComponent(match[1]) : null;

  if (isValidSessionId(raw)) {
    ensureSessionCredentialsDir(raw);
    return { ctx: sessionContext(raw), newSessionId: null };
  }

  const newId = issueNewSessionId();
  return { ctx: sessionContext(newId), newSessionId: newId };
}

/** New session id for middleware when cookie is absent or invalid. */
export function issueNewSessionId(): string {
  const id = createSessionId();
  ensureSessionCredentialsDir(id);
  return id;
}

export function credentialsDirLabel(ctx: CredentialContext): string {
  if (ctx.scope === "session" && ctx.sessionId) {
    return path.join("credentials", "sessions", ctx.sessionId.slice(0, 8) + "…");
  }
  return "credentials/";
}
