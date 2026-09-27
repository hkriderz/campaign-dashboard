/** Normalize STW PDI and knock PRIMARYID for equality. */
export function normalizeRecontactPersonId(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * True when `query` matches a PDI / PRIMARYID or a voter name.
 * ID match strips spaces and ignores case, so `CA55278516` and `ca 55278516` both hit.
 * Name match is a case-insensitive substring. An empty query matches every row.
 */
export function matchesPdiOrNameQuery(query: string, personId: string, name: string): boolean {
  const raw = query.trim();
  if (!raw) return true;
  const idNeedle = normalizeRecontactPersonId(raw);
  const id = normalizeRecontactPersonId(personId);
  if (idNeedle && id.includes(idNeedle)) return true;
  const nameNeedle = raw.replace(/\s+/g, " ").toUpperCase();
  const nameHay = name.replace(/\s+/g, " ").trim().toUpperCase();
  return Boolean(nameNeedle) && nameHay.includes(nameNeedle);
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
