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

/**
 * Question title shared by answer columns.
 * `2. Disclaimer/Notes: left a message` and `Disclaimer/Notes` both become `Disclaimer/Notes`.
 */
export function wideColumnCollapseLabel(header: string): string {
  const trimmed = normalizeWideHeaderKey(header);
  const colon = trimmed.indexOf(":");
  const title = (colon > 0 ? trimmed.slice(0, colon) : trimmed).trim();
  const stripped = title.replace(/^\d+\.?\s+/, "").trim();
  return stripped || title || trimmed;
}

/** Case-insensitive key for {@link wideColumnCollapseLabel}. */
export function wideColumnCollapseKey(header: string): string {
  return wideColumnCollapseLabel(header).toLowerCase();
}

export type WideColumnVisualRow = {
  /** Set when this question has enough answers to collapse. */
  collapseKey: string | null;
  label: string;
  /** Indexes into `columnOrder`, in list order. */
  indexes: number[];
  collapsed: boolean;
};

/** Questions with more answers than this start collapsed. Ten or fewer stay open. */
export const WIDE_COLUMN_AUTO_COLLAPSE_MIN_ANSWERS = 10;

/** Collapse a question name only when it has more than 10 answers, unless `expandedKeys` opens it. */
export function buildWideColumnVisualRows(
  columnOrder: readonly string[],
  expandedKeys: ReadonlySet<string>
): WideColumnVisualRow[] {
  const keys = columnOrder.map((header) => wideColumnCollapseKey(header));
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const emitted = new Set<string>();
  const rows: WideColumnVisualRow[] = [];
  for (let i = 0; i < columnOrder.length; i++) {
    const key = keys[i] ?? "";
    const count = key ? counts.get(key) ?? 0 : 0;
    const collapsible = count > WIDE_COLUMN_AUTO_COLLAPSE_MIN_ANSWERS;
    if (collapsible && !expandedKeys.has(key)) {
      if (emitted.has(key)) continue;
      emitted.add(key);
      const indexes: number[] = [];
      for (let j = 0; j < keys.length; j++) {
        if (keys[j] === key) indexes.push(j);
      }
      rows.push({
        collapseKey: key,
        label: wideColumnCollapseLabel(columnOrder[indexes[0]!]!),
        indexes,
        collapsed: true,
      });
      continue;
    }
    rows.push({
      collapseKey: collapsible ? key : null,
      label: columnOrder[i]!,
      indexes: [i],
      collapsed: false,
    });
  }
  return rows;
}

/** Move a visual row (one column or a collapsed name group) onto another visual row. */
export function reorderWideColumnsByVisualRows(
  columnOrder: readonly string[],
  rows: readonly { indexes: readonly number[] }[],
  fromVisual: number,
  toVisual: number
): string[] {
  if (
    fromVisual === toVisual ||
    fromVisual < 0 ||
    toVisual < 0 ||
    fromVisual >= rows.length ||
    toVisual >= rows.length
  ) {
    return [...columnOrder];
  }
  const blocks = rows.map((row) => row.indexes.map((index) => columnOrder[index]!));
  const [block] = blocks.splice(fromVisual, 1);
  const insertAt = fromVisual < toVisual ? toVisual - 1 : toVisual;
  blocks.splice(insertAt, 0, block!);
  return blocks.flat();
}

/** Place a column block so its first header lands at a 1-based position. */
export function moveWideColumnBlock(
  columnOrder: readonly string[],
  indexes: readonly number[],
  oneBasedPosition: number
): string[] {
  if (!indexes.length) return [...columnOrder];
  const current = Math.min(...indexes) + 1;
  const target = Math.floor(oneBasedPosition);
  if (!Number.isFinite(target) || target === current) return [...columnOrder];
  const indexSet = new Set(indexes);
  const block = indexes.map((index) => columnOrder[index]!).filter((header) => header != null);
  const rest = columnOrder.filter((_, index) => !indexSet.has(index));
  const insertAt = Math.min(rest.length, Math.max(0, target - 1));
  const next = [...rest];
  next.splice(insertAt, 0, ...block);
  return next;
}
