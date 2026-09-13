/** Shared staff password that unlocks Canvassing and District Classifier. */
export const ACCESS_COOKIE_NAME = "cd_access";

export const UNLOCK_RATE_LIMIT_MAX = 10;
export const UNLOCK_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export function getAccessPassword(): string {
  return process.env.CAMPAIGN_DASHBOARD_ACCESS_PASSWORD?.trim() ?? "";
}

/** Gate is on only when the env password is a non-empty string. */
export function accessPasswordEnabled(): boolean {
  return getAccessPassword().length > 0;
}

export function isGatedSectionApiPath(pathname: string): boolean {
  return (
    pathname === "/api/canvassing" ||
    pathname.startsWith("/api/canvassing/") ||
    pathname === "/api/district-classifier" ||
    pathname.startsWith("/api/district-classifier/")
  );
}
