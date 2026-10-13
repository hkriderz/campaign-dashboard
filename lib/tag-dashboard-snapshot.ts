import { DateTime } from "luxon";
import { readSnapshotFreshness, type SnapshotFreshnessProbe } from "./bq-snapshot-store";

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

const TAG_FRESHNESS_FILES = [
  "daily-caller.json",
  "phone-banks.json",
  "question-stats.json",
  "call-survey-fill.json",
  "text-campaigns.json",
  "text-tag-stats.json",
  "text-contacts.json",
  "recontact-pairs.json",
  "unique-id-phone.json",
  "unique-id-text.json",
  "pdi-survey-rows.json",
] as const;

function newestSavedAt(probes: Array<SnapshotFreshnessProbe | null>): string | null {
  const times = probes.map((probe) => probe?.savedAt).filter((stamp): stamp is string => Boolean(stamp));
  if (!times.length) return null;
  return times.reduce((a, b) => (a > b ? a : b));
}

/**
 * Latest `savedAt` across dashboard snapshot files for a tag, plus display labels.
 * Reads the header of each file, not the row arrays.
 */
export function getTagDashboardSnapshotMeta(tagId: string): SnapshotFreshnessMeta {
  const files = TAG_FRESHNESS_FILES.map((fileName) => readSnapshotFreshness(tagId, fileName));
  const dataUpdatedAt = newestSavedAt(files);
  return {
    dataUpdatedAt,
    dataUpdatedAtLabel: formatSnapshotUpdatedLabel(dataUpdatedAt),
    hasDailyCaller: Boolean(files[0]?.hasRows),
    isStale: isSnapshotTimestampStale(dataUpdatedAt),
  };
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

/** Freshness of the unfiltered all-campaigns snapshot written by Rebuild all. */
export function getAllCampaignsSnapshotMeta(): SnapshotFreshnessMeta {
  const snap = readSnapshotFreshness("all-campaigns", "phone-banks.json");
  const dataUpdatedAt = snap?.savedAt ?? null;
  return {
    dataUpdatedAt,
    dataUpdatedAtLabel: formatSnapshotUpdatedLabel(dataUpdatedAt),
    hasDailyCaller: Boolean(snap?.hasRows),
    isStale: isSnapshotTimestampStale(dataUpdatedAt),
  };
}

/** Same savedAt as the phone tag bar: the newest snapshot file for this tag. */
export function getTextSnapshotMeta(tagId: string): SnapshotFreshnessMeta {
  const meta = getTagDashboardSnapshotMeta(tagId);
  const campaigns = readSnapshotFreshness(tagId, "text-campaigns.json");
  const stats = readSnapshotFreshness(tagId, "text-tag-stats.json");
  return {
    ...meta,
    hasDailyCaller: meta.hasDailyCaller || Boolean(campaigns?.hasRows || stats?.hasRows),
  };
}
