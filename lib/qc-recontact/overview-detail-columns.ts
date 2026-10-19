/**
 * Shared detail-column registry for Canvasser / Phonebanker overview dropdowns.
 * Layout is UI-only; full detail rows stay in the payload.
 */

import { recordedSurveyAnswer } from "./labels";

export type OverviewDetailColumnId =
  | "actorName"
  | "originalFlag"
  | "originalFlagDate"
  | "pdiId"
  | "voterFirstName"
  | "voterLastName"
  | "address"
  | "contactedAnswer"
  | "notesAnswer"
  | "pollingLabel"
  | "finalResultLabel"
  | "callerName"
  | "callDate"
  | "callTime";

export type OverviewDetailColumnDef = {
  id: OverviewDetailColumnId;
  /** Label in the Columns checklist. */
  label: string;
  /** CSV / table header for canvasser overview. */
  canvasserHeader: string;
  /** CSV / table header for phonebanker overview. */
  phonebankerHeader: string;
};

export const OVERVIEW_DETAIL_COLUMNS: readonly OverviewDetailColumnDef[] = [
  {
    id: "actorName",
    label: "Canvassed / Phoned by",
    canvasserHeader: "Canvassed by",
    phonebankerHeader: "Phoned by",
  },
  {
    id: "originalFlag",
    label: "Original flag",
    canvasserHeader: "Original flag",
    phonebankerHeader: "Original flag",
  },
  {
    id: "originalFlagDate",
    label: "Original flag date",
    canvasserHeader: "Original flag date",
    phonebankerHeader: "Original flag date",
  },
  {
    id: "pdiId",
    label: "PDI",
    canvasserHeader: "PDI",
    phonebankerHeader: "PDI",
  },
  {
    id: "voterFirstName",
    label: "First name",
    canvasserHeader: "First name",
    phonebankerHeader: "First name",
  },
  {
    id: "voterLastName",
    label: "Last name",
    canvasserHeader: "Last name",
    phonebankerHeader: "Last name",
  },
  {
    id: "address",
    label: "Address",
    canvasserHeader: "Address",
    phonebankerHeader: "Address",
  },
  {
    id: "contactedAnswer",
    label: "Were you contacted?",
    canvasserHeader: "Were you contacted?",
    phonebankerHeader: "Were you contacted?",
  },
  {
    id: "notesAnswer",
    label: "Notes",
    canvasserHeader: "Notes",
    phonebankerHeader: "Notes",
  },
  {
    id: "pollingLabel",
    label: "Polling",
    canvasserHeader: "Polling",
    phonebankerHeader: "Polling",
  },
  {
    id: "finalResultLabel",
    label: "Final result",
    canvasserHeader: "Final result",
    phonebankerHeader: "Final result",
  },
  {
    id: "callerName",
    label: "QC caller",
    canvasserHeader: "QC caller",
    phonebankerHeader: "QC caller",
  },
  {
    id: "callDate",
    label: "Call date",
    canvasserHeader: "Call date",
    phonebankerHeader: "Call date",
  },
  {
    id: "callTime",
    label: "Call time",
    canvasserHeader: "Call time",
    phonebankerHeader: "Call time",
  },
] as const;

export const ALL_OVERVIEW_DETAIL_COLUMN_IDS: readonly OverviewDetailColumnId[] =
  OVERVIEW_DETAIL_COLUMNS.map((c) => c.id);

export const CANVASSER_OVERVIEW_DETAIL_COLS_STORAGE_KEY =
  "campaign-dashboard:canvasser-overview-detail-cols:v1";
export const PHONEBANKER_OVERVIEW_DETAIL_COLS_STORAGE_KEY =
  "campaign-dashboard:phonebanker-overview-detail-cols:v1";

/** Columns that default to visible when a saved layout omits them (e.g. Notes added later). */
const DEFAULT_ON_IF_MISSING: ReadonlySet<OverviewDetailColumnId> = new Set(["notesAnswer"]);

export type OverviewDetailRowLike = {
  canvasserName?: string;
  phonebankerName?: string;
  originalFlag: string;
  originalFlagDate: string;
  pdiId: string;
  voterFirstName: string;
  voterLastName: string;
  address: string;
  contactedAnswer: string;
  notesAnswer: string;
  pollingLabel: string;
  finalResultLabel: string;
  callerName: string;
  callDate: string;
  callTime: string;
};

export function defaultVisibleOverviewDetailColumnIds(): OverviewDetailColumnId[] {
  return [...ALL_OVERVIEW_DETAIL_COLUMN_IDS];
}

export function parseOverviewDetailColumnIds(raw: string | null): OverviewDetailColumnId[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const known = new Set(ALL_OVERVIEW_DETAIL_COLUMN_IDS);
    const ids = parsed.filter((x): x is OverviewDetailColumnId => typeof x === "string" && known.has(x as OverviewDetailColumnId));
    if (!ids.length) return null;
    // Preserve registry order; treat missing Notes (and similar) as on.
    const selected = new Set(ids);
    for (const id of DEFAULT_ON_IF_MISSING) {
      if (!parsed.includes(id)) selected.add(id);
    }
    return ALL_OVERVIEW_DETAIL_COLUMN_IDS.filter((id) => selected.has(id));
  } catch {
    return null;
  }
}

export function loadOverviewDetailColumnIds(storageKey: string): OverviewDetailColumnId[] {
  if (typeof window === "undefined") return defaultVisibleOverviewDetailColumnIds();
  try {
    return parseOverviewDetailColumnIds(window.localStorage.getItem(storageKey)) ?? defaultVisibleOverviewDetailColumnIds();
  } catch {
    return defaultVisibleOverviewDetailColumnIds();
  }
}

export function saveOverviewDetailColumnIds(storageKey: string, ids: readonly OverviewDetailColumnId[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    // ignore quota / private mode
  }
}

/** Toggle a column; keeps at least one visible. */
export function toggleOverviewDetailColumn(
  current: readonly OverviewDetailColumnId[],
  id: OverviewDetailColumnId,
  on: boolean
): OverviewDetailColumnId[] {
  const set = new Set(current);
  if (on) set.add(id);
  else {
    if (set.size <= 1 && set.has(id)) return ALL_OVERVIEW_DETAIL_COLUMN_IDS.filter((c) => set.has(c));
    set.delete(id);
  }
  if (set.size === 0) return defaultVisibleOverviewDetailColumnIds();
  return ALL_OVERVIEW_DETAIL_COLUMN_IDS.filter((c) => set.has(c));
}

export function overviewDetailCellValue(
  detail: OverviewDetailRowLike,
  id: OverviewDetailColumnId
): string {
  switch (id) {
    case "actorName":
      return (detail.canvasserName ?? detail.phonebankerName ?? "").trim();
    case "originalFlag":
      return detail.originalFlag;
    case "originalFlagDate":
      return detail.originalFlagDate;
    case "pdiId":
      return detail.pdiId;
    case "voterFirstName":
      return detail.voterFirstName;
    case "voterLastName":
      return detail.voterLastName;
    case "address":
      return detail.address;
    case "contactedAnswer":
      return detail.contactedAnswer;
    case "notesAnswer":
      return detail.notesAnswer;
    case "pollingLabel":
      return detail.pollingLabel;
    case "finalResultLabel":
      return detail.finalResultLabel;
    case "callerName":
      return detail.callerName;
    case "callDate":
      return detail.callDate;
    case "callTime":
      return detail.callTime;
    default:
      return "";
  }
}

export function overviewDetailHeadersForColumns(
  ids: readonly OverviewDetailColumnId[],
  variant: "canvasser" | "phonebanker"
): string[] {
  const byId = new Map(OVERVIEW_DETAIL_COLUMNS.map((c) => [c.id, c] as const));
  return ids.map((id) => {
    const def = byId.get(id)!;
    return variant === "canvasser" ? def.canvasserHeader : def.phonebankerHeader;
  });
}

export function overviewDetailValuesForColumns(
  detail: OverviewDetailRowLike,
  ids: readonly OverviewDetailColumnId[]
): string[] {
  return ids.map((id) => overviewDetailCellValue(detail, id));
}

/** Tab-separated detail table for clipboard (headers + all detail rows). */
export function buildOverviewDetailTsv(
  details: readonly OverviewDetailRowLike[],
  ids: readonly OverviewDetailColumnId[],
  variant: "canvasser" | "phonebanker"
): string {
  const headers = overviewDetailHeadersForColumns(ids, variant);
  const lines = [headers.join("\t")];
  for (const detail of details) {
    lines.push(
      overviewDetailValuesForColumns(detail, ids)
        .map((cell) => String(cell).replace(/\t/g, " ").replace(/\r?\n/g, " "))
        .join("\t")
    );
  }
  return lines.join("\n");
}

/** True when the detail has a non-empty Disclaimer/Notes short answer. */
export function overviewDetailHasNotes(detail: { notesAnswer?: string | null }): boolean {
  return Boolean(recordedSurveyAnswer(detail.notesAnswer));
}

/**
 * When `hasNotesOnly` is on, keep actors with ≥1 note detail and trim details to those notes.
 * Off returns the same array reference.
 */
export function filterOverviewRowsByHasNotes<
  T extends { details: D[] },
  D extends { notesAnswer?: string | null },
>(rows: readonly T[], hasNotesOnly: boolean): T[] {
  if (!hasNotesOnly) return rows as T[];
  return rows
    .map((row) => ({
      ...row,
      details: row.details.filter((detail) => overviewDetailHasNotes(detail)),
    }))
    .filter((row) => row.details.length > 0);
}
