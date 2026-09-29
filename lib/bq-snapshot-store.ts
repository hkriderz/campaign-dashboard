/**
 * File-backed snapshots for tag-scoped dashboard data.
 * Normal reads use these files when present. If a tag has no snapshot file yet, fetch helpers
 * pull BigQuery once, write JSON, then serve from disk on later requests. **Refresh** merges the
 * last three Pacific days when the files already exist. **Rebuild** reloads history since 2025-12-01.
 */
import fs from "fs";
import path from "path";
import type { QcRecontactPair, QcTextContactSummary } from "./qc-recontact/types";
import type { PdiSurveyRow } from "./queries/qc-recontact";
import type {
  CallSurveyRowForFill,
  PhoneBankSummary,
  PhonebankerQuestionResponseStat,
  TagDailyCallerStat,
  TextCampaignSummary,
  TextContactTagStat,
} from "./types";
import type { UniqueIdContactEvent } from "./unique-ids/types";

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

export type RecontactPairsSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  pairs: QcRecontactPair[];
};

export type UniqueIdEventsSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: UniqueIdContactEvent[];
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

export function loadRecontactPairsSnapshot(tagId: string): RecontactPairsSnapshotFile | null {
  const fp = path.join(DATA_DIR, safeTag(tagId), "recontact-pairs.json");
  const data = readJson<RecontactPairsSnapshotFile>(fp);
  if (!data || data.version !== SNAPSHOT_VERSION || data.tagId !== tagId) return null;
  if (!Array.isArray(data.pairs)) return null;
  return data;
}

export function saveRecontactPairsSnapshot(
  tagId: string,
  pairs: QcRecontactPair[],
  options?: SnapshotSaveOptions
): void {
  const dir = ensureDir(tagId);
  const fp = path.join(dir, "recontact-pairs.json");
  if (!options?.touchEvenIfUnchanged && stableRowsUnchanged(fp, pairs)) return;
  const payload: RecontactPairsSnapshotFile = {
    version: SNAPSHOT_VERSION,
    tagId,
    savedAt: new Date().toISOString(),
    pairs,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), "utf-8");
}

export function loadUniqueIdPhoneSnapshot(tagId: string): UniqueIdEventsSnapshotFile | null {
  const fp = path.join(DATA_DIR, safeTag(tagId), "unique-id-phone.json");
  const data = readJson<UniqueIdEventsSnapshotFile>(fp);
  if (!data || data.version !== SNAPSHOT_VERSION || data.tagId !== tagId) return null;
  if (!Array.isArray(data.rows)) return null;
  return data;
}

export function saveUniqueIdPhoneSnapshot(
  tagId: string,
  rows: UniqueIdContactEvent[],
  options?: SnapshotSaveOptions
): void {
  const dir = ensureDir(tagId);
  const fp = path.join(dir, "unique-id-phone.json");
  if (!options?.touchEvenIfUnchanged && stableRowsUnchanged(fp, rows)) return;
  const payload: UniqueIdEventsSnapshotFile = {
    version: SNAPSHOT_VERSION,
    tagId,
    savedAt: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), "utf-8");
}

export function loadUniqueIdTextSnapshot(tagId: string): UniqueIdEventsSnapshotFile | null {
  const fp = path.join(DATA_DIR, safeTag(tagId), "unique-id-text.json");
  const data = readJson<UniqueIdEventsSnapshotFile>(fp);
  if (!data || data.version !== SNAPSHOT_VERSION || data.tagId !== tagId) return null;
  if (!Array.isArray(data.rows)) return null;
  return data;
}

export function saveUniqueIdTextSnapshot(
  tagId: string,
  rows: UniqueIdContactEvent[],
  options?: SnapshotSaveOptions
): void {
  const dir = ensureDir(tagId);
  const fp = path.join(dir, "unique-id-text.json");
  if (!options?.touchEvenIfUnchanged && stableRowsUnchanged(fp, rows)) return;
  const payload: UniqueIdEventsSnapshotFile = {
    version: SNAPSHOT_VERSION,
    tagId,
    savedAt: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), "utf-8");
}

export type PdiSurveySnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: PdiSurveyRow[];
};

export type TextContactsSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: QcTextContactSummary[];
};

export type TextCampaignsSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: TextCampaignSummary[];
};

export type TextTagStatsSnapshotFile = {
  version: number;
  tagId: string;
  savedAt: string;
  rows: TextContactTagStat[];
};

const ALL_CAMPAIGNS_TAG_ID = "all-campaigns";

function loadSnapshotFile<T extends { version: number; tagId: string }>(
  tagId: string,
  fileName: string
): T | null {
  const fp = path.join(DATA_DIR, safeTag(tagId), fileName);
  const data = readJson<T>(fp);
  if (!data || data.version !== SNAPSHOT_VERSION || data.tagId !== tagId) return null;
  return data;
}

function saveSnapshotFile<T>(
  tagId: string,
  fileName: string,
  rows: T[],
  options?: SnapshotSaveOptions
): void {
  const dir = ensureDir(tagId);
  const fp = path.join(dir, fileName);
  if (!options?.touchEvenIfUnchanged && stableRowsUnchanged(fp, rows)) return;
  const payload = {
    version: SNAPSHOT_VERSION,
    tagId,
    savedAt: new Date().toISOString(),
    rows,
  };
  fs.writeFileSync(fp, JSON.stringify(payload), "utf-8");
}

export function loadPdiSurveySnapshot(tagId: string): PdiSurveySnapshotFile | null {
  const data = loadSnapshotFile<PdiSurveySnapshotFile>(tagId, "pdi-survey-rows.json");
  if (!data || !Array.isArray(data.rows)) return null;
  return data;
}

export function savePdiSurveySnapshot(
  tagId: string,
  rows: PdiSurveyRow[],
  options?: SnapshotSaveOptions
): void {
  saveSnapshotFile(tagId, "pdi-survey-rows.json", rows, options);
}

export function loadTextContactsSnapshot(tagId: string): TextContactsSnapshotFile | null {
  const data = loadSnapshotFile<TextContactsSnapshotFile>(tagId, "text-contacts.json");
  if (!data || !Array.isArray(data.rows)) return null;
  return data;
}

export function saveTextContactsSnapshot(
  tagId: string,
  rows: QcTextContactSummary[],
  options?: SnapshotSaveOptions
): void {
  saveSnapshotFile(tagId, "text-contacts.json", rows, options);
}

export function loadTextCampaignsSnapshot(tagId: string): TextCampaignsSnapshotFile | null {
  const data = loadSnapshotFile<TextCampaignsSnapshotFile>(tagId, "text-campaigns.json");
  if (!data || !Array.isArray(data.rows)) return null;
  return data;
}

export function saveTextCampaignsSnapshot(
  tagId: string,
  rows: TextCampaignSummary[],
  options?: SnapshotSaveOptions
): void {
  saveSnapshotFile(tagId, "text-campaigns.json", rows, options);
}

export function loadTextTagStatsSnapshot(tagId: string): TextTagStatsSnapshotFile | null {
  const data = loadSnapshotFile<TextTagStatsSnapshotFile>(tagId, "text-tag-stats.json");
  if (!data || !Array.isArray(data.rows)) return null;
  return data;
}

export function saveTextTagStatsSnapshot(
  tagId: string,
  rows: TextContactTagStat[],
  options?: SnapshotSaveOptions
): void {
  saveSnapshotFile(tagId, "text-tag-stats.json", rows, options);
}

export function loadAllCampaignsSnapshot(): PhoneBanksSnapshotFile | null {
  return loadPhoneBanksSnapshot(ALL_CAMPAIGNS_TAG_ID);
}

export function saveAllCampaignsSnapshot(rows: PhoneBankSummary[], options?: SnapshotSaveOptions): void {
  savePhoneBanksSnapshot(ALL_CAMPAIGNS_TAG_ID, rows, options);
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
    "recontact-pairs.json",
    "unique-id-phone.json",
    "unique-id-text.json",
    "pdi-survey-rows.json",
    "text-contacts.json",
    "text-campaigns.json",
    "text-tag-stats.json",
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
