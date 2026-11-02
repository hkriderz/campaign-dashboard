import "server-only";

import fs from "fs";
import path from "path";
import { DEFAULT_DOORKNOCK_SUMMARY_SETTINGS } from "@/lib/canvassing/doorknocks-results/types";
import { defaultShiftSettings } from "@/lib/canvassing/knock-report-view";
import { builtInPhonebankGapShiftSettings } from "@/lib/phonebanking/gap-report/shift";
import { normalizeDoorknockSettings } from "@/lib/canvassing/doorknocks-results/parser";
import type {
  KnockAnalysisSystemDefaults,
  PhonebankGapsSystemDefaults,
  ReportDefaultKind,
  ReportDefaultSettingsByKind,
  ReportDefaultsResponse,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "report-defaults");

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(kind: ReportDefaultKind): string {
  return path.join(DATA_DIR, `${kind}.json`);
}

function isHm(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

function builtInKnockDefaults(): KnockAnalysisSystemDefaults {
  const seed = defaultShiftSettings("lunch");
  return {
    startTime: seed.startTime,
    lunchClockOutTime: seed.lunchClockOutTime,
    lunchReturnTime: seed.lunchReturnTime,
    endTime: seed.endTime,
    customGapMinutes: null,
  };
}

function builtInPhonebankDefaults(): PhonebankGapsSystemDefaults {
  const seed = builtInPhonebankGapShiftSettings();
  return {
    startTime: seed.startTime,
    lunchClockOutTime: seed.lunchClockOutTime,
    lunchReturnTime: seed.lunchReturnTime,
    endTime: seed.endTime,
    preLunchBreakStart: seed.preLunchBreakStart,
    postLunchBreakStart: seed.postLunchBreakStart,
  };
}

export function getBuiltInReportDefaults<K extends ReportDefaultKind>(
  kind: K
): ReportDefaultSettingsByKind[K] {
  if (kind === "knock-analysis") {
    return builtInKnockDefaults() as ReportDefaultSettingsByKind[K];
  }
  if (kind === "phonebank-gaps") {
    return builtInPhonebankDefaults() as ReportDefaultSettingsByKind[K];
  }
  return { ...DEFAULT_DOORKNOCK_SUMMARY_SETTINGS } as ReportDefaultSettingsByKind[K];
}

function normalizeKnockDefaults(raw: unknown): KnockAnalysisSystemDefaults {
  const seed = builtInKnockDefaults();
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const customRaw = obj.customGapMinutes;
  let customGapMinutes: number | null = null;
  if (customRaw === null || customRaw === undefined || customRaw === "") {
    customGapMinutes = null;
  } else {
    const n = Number(customRaw);
    if (Number.isFinite(n) && n >= 11 && n <= 180) customGapMinutes = Math.round(n);
  }
  return {
    startTime: isHm(obj.startTime) ? obj.startTime : seed.startTime,
    lunchClockOutTime: isHm(obj.lunchClockOutTime) ? obj.lunchClockOutTime : seed.lunchClockOutTime,
    lunchReturnTime: isHm(obj.lunchReturnTime) ? obj.lunchReturnTime : seed.lunchReturnTime,
    endTime: isHm(obj.endTime) ? obj.endTime : seed.endTime,
    customGapMinutes,
  };
}

function normalizePhonebankDefaults(raw: unknown): PhonebankGapsSystemDefaults {
  const seed = builtInPhonebankDefaults();
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    startTime: isHm(obj.startTime) ? obj.startTime : seed.startTime,
    lunchClockOutTime: isHm(obj.lunchClockOutTime) ? obj.lunchClockOutTime : seed.lunchClockOutTime,
    lunchReturnTime: isHm(obj.lunchReturnTime) ? obj.lunchReturnTime : seed.lunchReturnTime,
    endTime: isHm(obj.endTime) ? obj.endTime : seed.endTime,
    preLunchBreakStart: isHm(obj.preLunchBreakStart)
      ? obj.preLunchBreakStart
      : seed.preLunchBreakStart,
    postLunchBreakStart: isHm(obj.postLunchBreakStart)
      ? obj.postLunchBreakStart
      : seed.postLunchBreakStart,
  };
}

function normalizeSettings<K extends ReportDefaultKind>(
  kind: K,
  raw: unknown
): ReportDefaultSettingsByKind[K] {
  if (kind === "knock-analysis") {
    return normalizeKnockDefaults(raw) as ReportDefaultSettingsByKind[K];
  }
  if (kind === "phonebank-gaps") {
    return normalizePhonebankDefaults(raw) as ReportDefaultSettingsByKind[K];
  }
  return normalizeDoorknockSettings(
    (raw && typeof raw === "object" ? raw : {}) as Partial<
      ReportDefaultSettingsByKind["doorknocks-results"]
    >
  ) as ReportDefaultSettingsByKind[K];
}

export function loadReportDefaults<K extends ReportDefaultKind>(
  kind: K
): ReportDefaultsResponse<K> {
  ensureDir();
  const fp = filePath(kind);
  if (!fs.existsSync(fp)) {
    return { kind, source: "built-in", settings: getBuiltInReportDefaults(kind) };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as unknown;
    return { kind, source: "system", settings: normalizeSettings(kind, raw) };
  } catch {
    return { kind, source: "built-in", settings: getBuiltInReportDefaults(kind) };
  }
}

export function saveReportDefaults<K extends ReportDefaultKind>(
  kind: K,
  raw: unknown
): ReportDefaultsResponse<K> {
  ensureDir();
  const settings = normalizeSettings(kind, raw);
  const fp = filePath(kind);
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf-8");
  fs.renameSync(tmp, fp);
  return { kind, source: "system", settings };
}

export function clearReportDefaults<K extends ReportDefaultKind>(
  kind: K
): ReportDefaultsResponse<K> {
  ensureDir();
  const fp = filePath(kind);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  return { kind, source: "built-in", settings: getBuiltInReportDefaults(kind) };
}
