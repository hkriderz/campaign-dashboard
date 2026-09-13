/** Normalize STW PDI and knock PRIMARYID for equality. */
export function normalizeRecontactPersonId(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

export function callOccurredBefore(
  priorDate: string,
  priorAt: string | undefined,
  qcDate: string,
  qcAt: string | undefined
): boolean {
  const priorStamp = (priorAt ?? "").trim();
  const qcStamp = (qcAt ?? "").trim();
  if (priorStamp && qcStamp) return priorStamp < qcStamp;
  return priorDate < qcDate;
}
