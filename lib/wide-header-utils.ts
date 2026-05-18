/**
 * Shared helpers for wide PB / STW CSV header matching.
 */
export function normalizeWideHeaderKey(header: string): string {
  return header.trim().replace(/\s+/g, " ");
}

/** Strip common Scale-to-Win / script prefixes so regex rules match the trailing label. */
export function stripWideQuestionPrefixes(header: string): string {
  return header
    .replace(/^canvass(?:ing)?\s+results?\s*[-–—:]\s*/i, "")
    .replace(/^canvass(?:ing)?\s+result\s*[-–—:]\s*/i, "")
    .replace(/^canvass\s*[-–—:]\s*/i, "")
    .trim();
}
