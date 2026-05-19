/** Session-scoped credential storage (per-browser isolation). */
export function sessionCredentialsEnabled(): boolean {
  return process.env.CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS === "1";
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

/** Delete session credential folders older than this (hours). */
export function sessionCredentialsTtlHours(): number {
  const raw = process.env.CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS_TTL_HOURS;
  if (raw == null || raw.trim() === "") return 72;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 72;
  return Math.min(n, 24 * 30);
}
