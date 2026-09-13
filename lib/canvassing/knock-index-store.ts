import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { normalizeRecontactPersonId } from "../qc-recontact/ids";
import type { QcCanvassKnockIndexRow } from "../qc-recontact/types";
import type { CanvassingKnockEvent } from "./types";

export type KnockIndexImportSource = "overview" | "knock-analysis" | "seed";

export type KnockIndexImportMeta = {
  id: string;
  importedAt: string;
  source: KnockIndexImportSource;
  reportId: string;
  fileNames: string[];
  rowsAdded: number;
  rowsSkippedDup: number;
  rowsSkippedNoPrimaryId: number;
};

export type KnockIndexFile = {
  version: 1;
  updatedAt: string;
  imports: KnockIndexImportMeta[];
  rows: QcCanvassKnockIndexRow[];
};

export type AppendKnockIndexResult = {
  importMeta: KnockIndexImportMeta;
  rowCount: number;
};

const DATA_ROOT = path.join(process.cwd(), "data", "canvassing-reports");
const INDEX_PATH = path.join(DATA_ROOT, "knock-index.json");

function ensureStoreDir(): void {
  if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });
}

function emptyIndex(): KnockIndexFile {
  return {
    version: 1,
    updatedAt: "",
    imports: [],
    rows: [],
  };
}

function isIndexRow(value: unknown): value is QcCanvassKnockIndexRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<QcCanvassKnockIndexRow>;
  return (
    typeof row.primaryId === "string" &&
    typeof row.canvasserName === "string" &&
    typeof row.assignmentName === "string" &&
    typeof row.occurredAt === "string" &&
    typeof row.question === "string" &&
    typeof row.response === "string" &&
    typeof row.reportId === "string"
  );
}

function hydrateIndex(raw: Partial<KnockIndexFile>): KnockIndexFile {
  const rows = Array.isArray(raw.rows) ? raw.rows.filter(isIndexRow) : [];
  const imports = Array.isArray(raw.imports)
    ? raw.imports.filter((item): item is KnockIndexImportMeta => {
        return Boolean(item && typeof item === "object" && typeof item.id === "string");
      })
    : [];
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    imports,
    rows,
  };
}

export function knockIndexDedupKey(row: Pick<QcCanvassKnockIndexRow, "primaryId" | "occurredAt" | "question" | "response">): string {
  return [
    normalizeRecontactPersonId(row.primaryId),
    row.occurredAt.trim(),
    row.question.trim(),
    row.response.trim(),
  ].join("|");
}

export function loadKnockIndex(): KnockIndexFile {
  ensureStoreDir();
  if (!fs.existsSync(INDEX_PATH)) return emptyIndex();
  try {
    return hydrateIndex(JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) as Partial<KnockIndexFile>);
  } catch {
    return emptyIndex();
  }
}

export function loadKnockIndexRows(): QcCanvassKnockIndexRow[] {
  return loadKnockIndex().rows;
}

function writeKnockIndex(index: KnockIndexFile): void {
  ensureStoreDir();
  const tmpPath = `${INDEX_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(index), "utf-8");
  fs.renameSync(tmpPath, INDEX_PATH);
}

export function knockEventToIndexRow(event: CanvassingKnockEvent, reportId: string): QcCanvassKnockIndexRow | null {
  const primaryId = event.primaryId.trim();
  if (!normalizeRecontactPersonId(primaryId)) return null;
  return {
    primaryId,
    canvasserName: event.canvasserName,
    assignmentName: event.assignmentName,
    occurredAt: event.occurredAt,
    question: event.question,
    response: event.response,
    reportId,
    sourceFileName: event.sourceFileName,
  };
}

export function appendKnockIndexRows(
  incoming: readonly QcCanvassKnockIndexRow[],
  meta: {
    source: KnockIndexImportSource;
    reportId?: string;
    fileNames?: string[];
  }
): AppendKnockIndexResult {
  const index = loadKnockIndex();
  const seen = new Set(index.rows.map(knockIndexDedupKey));
  const added: QcCanvassKnockIndexRow[] = [];
  let rowsSkippedDup = 0;
  let rowsSkippedNoPrimaryId = 0;

  for (const row of incoming) {
    if (!normalizeRecontactPersonId(row.primaryId)) {
      rowsSkippedNoPrimaryId += 1;
      continue;
    }
    const key = knockIndexDedupKey(row);
    if (seen.has(key)) {
      rowsSkippedDup += 1;
      continue;
    }
    seen.add(key);
    added.push(row);
  }

  const importId = crypto.randomUUID();
  const now = new Date().toISOString();
  const importMeta: KnockIndexImportMeta = {
    id: importId,
    importedAt: now,
    source: meta.source,
    reportId: meta.reportId?.trim() || importId,
    fileNames: (meta.fileNames ?? []).filter(Boolean),
    rowsAdded: added.length,
    rowsSkippedDup,
    rowsSkippedNoPrimaryId,
  };

  if (added.length || importMeta.fileNames.length) {
    writeKnockIndex({
      version: 1,
      updatedAt: now,
      imports: [...index.imports, importMeta],
      rows: [...index.rows, ...added],
    });
  }

  return { importMeta, rowCount: index.rows.length + added.length };
}

export function appendKnockEventsToIndex(
  events: readonly CanvassingKnockEvent[],
  meta: {
    source: KnockIndexImportSource;
    reportId?: string;
    fileNames?: string[];
  }
): AppendKnockIndexResult {
  const reportId = meta.reportId?.trim() || crypto.randomUUID();
  const rows: QcCanvassKnockIndexRow[] = [];
  let rowsSkippedNoPrimaryId = 0;
  for (const event of events) {
    const row = knockEventToIndexRow(event, reportId);
    if (!row) {
      rowsSkippedNoPrimaryId += 1;
      continue;
    }
    rows.push(row);
  }
  const result = appendKnockIndexRows(rows, { ...meta, reportId });
  result.importMeta.rowsSkippedNoPrimaryId += rowsSkippedNoPrimaryId;
  return result;
}
