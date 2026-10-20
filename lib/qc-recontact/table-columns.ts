/**
 * On-screen recontact table columns. Copy table follows the same checklist.
 * Download CSV stays the full export.
 */

export type RecontactTableColumnId =
  | "change"
  | "pdi"
  | "prior"
  | "priorResult"
  | "qc"
  | "contacted"
  | "notes"
  | "polling"
  | "result";

export type RecontactTableColumnDef = {
  id: RecontactTableColumnId;
  /** Label in the Columns checklist and the on-screen header. */
  label: string;
  /** Copy-table headers this column expands into. */
  headers: readonly string[];
};

export const RECONTACT_TABLE_COLUMNS: readonly RecontactTableColumnDef[] = [
  { id: "change", label: "Change", headers: ["Change"] },
  { id: "pdi", label: "PDI", headers: ["PDI", "Voter name", "Voter address"] },
  { id: "prior", label: "Prior", headers: ["Prior", "Prior channel", "Prior date", "Prior list"] },
  { id: "priorResult", label: "Prior result", headers: ["Prior result"] },
  { id: "qc", label: "QC", headers: ["QC", "QC date", "QC list"] },
  { id: "contacted", label: "Were you contacted", headers: ["Were you contacted"] },
  { id: "notes", label: "Notes", headers: ["Notes"] },
  { id: "polling", label: "QC polling", headers: ["QC polling"] },
  { id: "result", label: "QC result", headers: ["QC result"] },
] as const;

export const ALL_RECONTACT_TABLE_COLUMN_IDS: readonly RecontactTableColumnId[] =
  RECONTACT_TABLE_COLUMNS.map((column) => column.id);

export const RECONTACT_TABLE_COLS_STORAGE_KEY = "campaign-dashboard:recontact-table-cols:v1";

const COLUMN_BY_ID = new Map(RECONTACT_TABLE_COLUMNS.map((column) => [column.id, column] as const));

export function defaultVisibleRecontactTableColumnIds(): RecontactTableColumnId[] {
  return [...ALL_RECONTACT_TABLE_COLUMN_IDS];
}

export function parseRecontactTableColumnIds(raw: string | null): RecontactTableColumnId[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const known = new Set(ALL_RECONTACT_TABLE_COLUMN_IDS);
    const selected = new Set(
      parsed.filter((value): value is RecontactTableColumnId => typeof value === "string" && known.has(value as RecontactTableColumnId))
    );
    if (!selected.size) return null;
    return ALL_RECONTACT_TABLE_COLUMN_IDS.filter((id) => selected.has(id));
  } catch {
    return null;
  }
}

export function loadRecontactTableColumnIds(storageKey = RECONTACT_TABLE_COLS_STORAGE_KEY): RecontactTableColumnId[] {
  if (typeof window === "undefined") return defaultVisibleRecontactTableColumnIds();
  try {
    return parseRecontactTableColumnIds(window.localStorage.getItem(storageKey)) ?? defaultVisibleRecontactTableColumnIds();
  } catch {
    return defaultVisibleRecontactTableColumnIds();
  }
}

export function saveRecontactTableColumnIds(
  ids: readonly RecontactTableColumnId[],
  storageKey = RECONTACT_TABLE_COLS_STORAGE_KEY
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    // ignore quota / private mode
  }
}

/** Toggle a column and keep checklist order. At least one column stays visible. */
export function toggleRecontactTableColumn(
  current: readonly RecontactTableColumnId[],
  id: RecontactTableColumnId,
  on: boolean
): RecontactTableColumnId[] {
  const set = new Set(current);
  if (on) set.add(id);
  else if (set.size <= 1 && set.has(id)) return ALL_RECONTACT_TABLE_COLUMN_IDS.filter((columnId) => set.has(columnId));
  else set.delete(id);
  if (set.size === 0) return defaultVisibleRecontactTableColumnIds();
  return ALL_RECONTACT_TABLE_COLUMN_IDS.filter((columnId) => set.has(columnId));
}

export function recontactTableHeadersForColumns(ids: readonly RecontactTableColumnId[]): string[] {
  return ids.flatMap((id) => [...(COLUMN_BY_ID.get(id)?.headers ?? [])]);
}

/** Indexes into a full copy-table row for the checked columns, in checklist order. */
export function recontactTableColumnIndexes(ids: readonly RecontactTableColumnId[]): number[] {
  const selected = new Set(ids);
  const indexes: number[] = [];
  let offset = 0;
  for (const column of RECONTACT_TABLE_COLUMNS) {
    const width = column.headers.length;
    if (selected.has(column.id)) {
      for (let index = 0; index < width; index++) indexes.push(offset + index);
    }
    offset += width;
  }
  return indexes;
}
