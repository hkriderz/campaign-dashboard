/**
 * QC list-name check with no filesystem imports, so client bundles can use it.
 * STW list names that belong on QC Calls pages (`LIKE '%qc%'`).
 */
export const QC_CAMPAIGN_NAME_MARKERS: readonly string[] = ["qc"];

/** True when a campaign display name looks like a QC list. */
export function campaignNameLooksLikeQc(campaignName: string): boolean {
  const name = campaignName.trim().toLowerCase();
  if (!name) return false;
  return QC_CAMPAIGN_NAME_MARKERS.some((raw) => {
    const marker = raw.trim().toLowerCase();
    return Boolean(marker) && name.includes(marker);
  });
}
