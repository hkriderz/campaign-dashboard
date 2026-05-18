import { DateTime } from "luxon";
import {
  loadCallSurveyFillSnapshot,
  loadDailyCallerSnapshot,
  loadPhoneBanksSnapshot,
  loadQuestionStatsSnapshot,
} from "./bq-snapshot-store";

const LA = "America/Los_Angeles";

export type SnapshotFreshnessMeta = {
  dataUpdatedAt: string | null;
  dataUpdatedAtLabel: string;
  hasDailyCaller: boolean;
  isStale: boolean;
};

/** Show stale banner when snapshot age exceeds this (hours). Set `0` to disable. */
function snapshotStaleAfterHours(): number {
  const raw = process.env.CAMPAIGN_DASHBOARD_SNAPSHOT_STALE_AFTER_HOURS;
  if (raw != null && String(raw).trim() === "0") return 0;
  if (raw == null || String(raw).trim() === "") return 6;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 6;
  return Math.min(n, 168);
}

function formatSnapshotUpdatedLabel(dataUpdatedAt: string | null): string {
  return dataUpdatedAt
    ? DateTime.fromISO(dataUpdatedAt, { zone: "utc" }).setZone(LA).toFormat("MMM d, yyyy h:mm a ZZZZ")
    : "Never";
}

function isSnapshotTimestampStale(dataUpdatedAt: string | null): boolean {
  const hours = snapshotStaleAfterHours();
  return (
    dataUpdatedAt != null &&
    hours > 0 &&
    Date.now() - new Date(dataUpdatedAt).getTime() > hours * 3600 * 1000
  );
}

/**
 * Latest `savedAt` across dashboard snapshot files for a tag, plus display labels.
 */
export function getTagDashboardSnapshotMeta(tagId: string): SnapshotFreshnessMeta {
  const dc = loadDailyCallerSnapshot(tagId);
  const pb = loadPhoneBanksSnapshot(tagId);
  const qs = loadQuestionStatsSnapshot(tagId);
  const cf = loadCallSurveyFillSnapshot(tagId);
  const times = [dc?.savedAt, pb?.savedAt, qs?.savedAt, cf?.savedAt].filter(Boolean) as string[];
  let dataUpdatedAt: string | null = null;
  if (times.length) {
    dataUpdatedAt = times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  }
  const dataUpdatedAtLabel = formatSnapshotUpdatedLabel(dataUpdatedAt);
  const hasDailyCaller = Boolean(dc?.rows?.length);
  const isStale = isSnapshotTimestampStale(dataUpdatedAt);

  return { dataUpdatedAt, dataUpdatedAtLabel, hasDailyCaller, isStale };
}

/**
 * Fleet-wide snapshot freshness for phone banking landing / campaign tags.
 * `dataUpdatedAt` is the newest tag snapshot; `isStale` if any active tag is stale.
 */
export function getPhonebankingSnapshotsMeta(tagIds: string[]): SnapshotFreshnessMeta {
  if (tagIds.length === 0) {
    return {
      dataUpdatedAt: null,
      dataUpdatedAtLabel: "Never",
      hasDailyCaller: false,
      isStale: false,
    };
  }

  const perTag = tagIds.map((id) => getTagDashboardSnapshotMeta(id));
  const times = perTag.map((m) => m.dataUpdatedAt).filter(Boolean) as string[];
  const dataUpdatedAt = times.length
    ? times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
    : null;

  return {
    dataUpdatedAt,
    dataUpdatedAtLabel: formatSnapshotUpdatedLabel(dataUpdatedAt),
    hasDailyCaller: perTag.some((m) => m.hasDailyCaller),
    isStale: perTag.some((m) => m.isStale),
  };
}
