/** True when this tag's QC pair rebuild should wait for a counterpart refreshed later in the same batch. */
export function qcSyncWaitsForLaterTag(tagId: string, laterTagIds: readonly string[]): boolean {
  const counterpart = tagId.startsWith("qc-") ? tagId.slice(3) : `qc-${tagId}`;
  return laterTagIds.includes(counterpart);
}
