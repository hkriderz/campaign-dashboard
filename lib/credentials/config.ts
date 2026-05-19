/** Session-scoped credential storage (per-browser isolation). */
export function sessionCredentialsEnabled(): boolean {
  const raw = process.env.CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS?.trim().toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Allow global `credentials/` + env vars when no session context (cron, local dev). */
export function allowGlobalCredentialFallback(): boolean {
  return process.env.CAMPAIGN_DASHBOARD_ALLOW_GLOBAL_CREDENTIALS !== "0";
}

/** HttpOnly cookie carrying the anonymous session id. */
export const SESSION_COOKIE_NAME = "cd_session";

/** Internal request header set by middleware for first-visit session resolution. */
export const SESSION_REQUEST_HEADER = "x-cd-session";

/** Max age for session cookie (30 days). */
export const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;

/**
 * Secure flag for `cd_session`. Default false so cookies work on HTTP deploys (Docker/Dokploy
 * without TLS). Set CAMPAIGN_DASHBOARD_SESSION_COOKIE_SECURE=1 when the site is HTTPS-only.
 */
export function sessionCookieSecure(): boolean {
  const raw = process.env.CAMPAIGN_DASHBOARD_SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return false;
}

export type SessionCookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

export function getSessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  };
}

/** Delete session credential folders older than this (hours). */
export function sessionCredentialsTtlHours(): number {
  const raw = process.env.CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS_TTL_HOURS;
  if (raw == null || String(raw).trim() === "") return 72;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 72;
  return Math.min(n, 24 * 30);
}
