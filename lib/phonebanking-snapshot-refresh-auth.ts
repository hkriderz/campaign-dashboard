/**
 * Snapshot refresh authorization.
 * Production always requires `x-snapshot-secret`.
 * `next dev` may refresh without a secret so local testing does not need the password field.
 */
export function isLocalSnapshotRefreshEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

export function authorizeSnapshotRefresh(req: Request): boolean {
  const secret = process.env.CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET?.trim();
  const provided = req.headers.get("x-snapshot-secret")?.trim() ?? "";
  if (secret && provided === secret) return true;
  return isLocalSnapshotRefreshEnabled();
}
