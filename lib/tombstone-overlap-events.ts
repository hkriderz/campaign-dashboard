/** CustomEvent name: tombstoned slices may still appear in BQ after a tag snapshot refresh. */
export const PB_CHECK_TOMBSTONES_EVENT = "pb-check-tombstones";

export function dispatchTombstoneOverlapCheck(tagId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PB_CHECK_TOMBSTONES_EVENT, { detail: { tagId } }));
}
