/**
 * File-backed snapshots for tag-scoped dashboard data.
 * Normal reads use these files when present. If a tag has no snapshot file yet, fetch helpers
 * pull BigQuery once, write JSON, then serve from disk on later requests. **Refresh all** always
 * runs a full BigQuery pass and overwrites the files.
 */
import fs from "fs";
import path from "path";
import type {
  CallSurveyRowForFill,
  PhoneBankSummary,
  PhonebankerQuestionResponseStat,
  TagDailyCallerStat,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "bq-snapshots");
const SNAPSHOT_VERSION = 1;

function safeTag(tag: string): string {
  return tag.replace(/[^a-z0-9_-]/gi, "");
}

function ensureDir(tag: string): string {
  const dir = path.join(DATA_DIR, safeTag(tag));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export type DailyCallerSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: TagDailyCallerStat[];
};

export type QuestionStatsSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: PhonebankerQuestionResponseStat[];
};

export type CallSurveyFillSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: CallSurveyRowForFill[];
};

export type PhoneBanksSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: PhoneBankSummary[];
};

function readJson<T>(fp: string): T | null {
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function snapshotsDisabled(): boolean {
  return process.env.BQ_SNAPSHOTS_DISABLED === "1";
}

export function loadDailyCallerSnapshot(tagId: string): DailyCallerSnapshotFile | null {
  const fp = path.join(DATA_DIR, safeTag(tagId), "daily-caller.json");
  const data = readJson<DailyCallerSnapshotFile>(fp);
  if (!data || data.version !== SNAPSHOT_VERSION || data.tagId !== tagId) return null;
  return data;
}

function stableRowsUnchanged<T>(fp: string, nextRows: T[]): boolean {
  if (!fs.existsSync(fp)) return false;
  try {
    const prev = JSON.parse(fs.readFileSync(fp, "utf-8")) as { rows?: T[] };
    return JSON.stringify(prev.rows ?? []) === JSON.stringify(nextRows);
  } catch {
    return false;
  }
}

/** Options for snapshot writes. */
export type SnapshotSaveOptions = {
  /**
   * After an explicit “Refresh all data”, always rewrite the file and bump `savedAt` even when
   * row JSON is unchanged — otherwise the UI timestamp never moves and looks broken.
   */
  touchEvenIfUnchanged?: boolean;
};

export function saveDailyCallerSnapshot(
  tagId: string,
  rows: TagDailyCallerStat[],
  options?: SnapshotSaveOptions
): void {
  const dir = ensureDir(tagId);
  const fp = path.join(dir, "daily-caller.json");
  if (!options?.touchEvenIfUnchanged && stableRowsUnchanged(fp, rows)) return;
  const payload: DailyCallerSnapshotFile = {
    version: SNAPSHOT_VERSION,
    tagId,
    savedAt: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), "utf-8");
}

export function loadQuestionStatsSnapshot(tagId: string): QuestionStatsSnapshotFile | null {
  const fp = path.join(DATA_DIR, safeTag(tagId), "question-stats.json");
  const data = readJson<QuestionStatsSnapshotFile>(fp);
  if (!data || data.version !== SNAPSHOT_VERSION || data.tagId !== tagId) return null;
  return data;
}

export function saveQuestionStatsSnapshot(
  tagId: string,
  rows: PhonebankerQuestionResponseStat[],
  options?: SnapshotSaveOptions
): void {
  const dir = ensureDir(tagId);
  const fp = path.join(dir, "question-stats.json");
  if (!options?.touchEvenIfUnchanged && stableRowsUnchanged(fp, rows)) return;
  const payload: QuestionStatsSnapshotFile = {
    version: SNAPSHOT_VERSION,
    tagId,
    savedAt: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), "utf-8");
}

export function loadCallSurveyFillSnapshot(tagId: string): CallSurveyFillSnapshotFile | null {
  const fp = path.join(DATA_DIR, safeTag(tagId), "call-survey-fill.json");
  const data = readJson<CallSurveyFillSnapshotFile>(fp);
  if (!data || data.version !== SNAPSHOT_VERSION || data.tagId !== tagId) return null;
  return data;
}

export function saveCallSurveyFillSnapshot(
  tagId: string,
  rows: CallSurveyRowForFill[],
  options?: SnapshotSaveOptions
): void {
  const dir = ensureDir(tagId);
  const fp = path.join(dir, "call-survey-fill.json");
  if (!options?.touchEvenIfUnchanged && stableRowsUnchanged(fp, rows)) return;
  const payload: CallSurveyFillSnapshotFile = {
    version: SNAPSHOT_VERSION,
    tagId,
    savedAt: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), "utf-8");
}

export function loadPhoneBanksSnapshot(tagId: string): PhoneBanksSnapshotFile | null {
  const fp = path.join(DATA_DIR, safeTag(tagId), "phone-banks.json");
  const data = readJson<PhoneBanksSnapshotFile>(fp);
  if (!data || data.version !== SNAPSHOT_VERSION || data.tagId !== tagId) return null;
  return data;
}

export function savePhoneBanksSnapshot(
  tagId: string,
  rows: PhoneBankSummary[],
  options?: SnapshotSaveOptions
): void {
  const dir = ensureDir(tagId);
  const fp = path.join(dir, "phone-banks.json");
  if (!options?.touchEvenIfUnchanged && stableRowsUnchanged(fp, rows)) return;
  const payload: PhoneBanksSnapshotFile = {
    version: SNAPSHOT_VERSION,
    tagId,
    savedAt: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), "utf-8");
}

/** Delete all snapshot JSON files for a tag (e.g. before full rebuild). */
export function clearTagSnapshots(tagId: string): void {
  const dir = path.join(DATA_DIR, safeTag(tagId));
  if (!fs.existsSync(dir)) return;
  for (const name of [
    "daily-caller.json",
    "question-stats.json",
    "call-survey-fill.json",
    "phone-banks.json",
  ]) {
    const fp = path.join(dir, name);
    if (fs.existsSync(fp)) {
      try {
        fs.unlinkSync(fp);
      } catch {
        /* ignore */
      }
    }
  }
}
