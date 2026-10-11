import { runQuery, PROJECT, TEXT_DATASET } from "../bigquery";
import {
  loadTextCampaignsSnapshot,
  loadTextTagStatsSnapshot,
  saveTextCampaignsSnapshot,
  saveTextTagStatsSnapshot,
  snapshotsDisabled,
} from "../bq-snapshot-store";
import { assertDataAccessAllowed } from "@/lib/credentials/gate";
import { buildTagWhereClause, getTagById } from "../campaign-tags";
import { createdAtOnOrAfterSql, upsertById } from "../snapshot-merge";
import { toDateString, toNum, toStr } from "./bq-row-parsers";
import type { TextCampaignSummary, TextCampaignUiStatus, TextContactTagStat } from "../types";

const P = PROJECT;
const D = TEXT_DATASET;
const TEXT_WINDOW_START_DATE = "2025-12-01";

function requireDashboardDataAccess(): void {
  assertDataAccessAllowed({ gcp: true });
}

export function textCampaignUiStatus(rawStatus: string): TextCampaignUiStatus {
  return rawStatus.trim().toUpperCase() === "INITIAL_SEND_COMPLETE" ? "Complete" : "Pending";
}

function rowToTextCampaign(r: Record<string, unknown>): TextCampaignSummary {
  const rawStatus = toStr(r.raw_status);
  return {
    campaignId: toStr(r.campaign_id),
    campaignName: toStr(r.campaign_name),
    rawStatus,
    status: textCampaignUiStatus(rawStatus),
    contactCount: toNum(r.contact_count),
    startedAt: toDateString(r.started_at),
    createdAt: toDateString(r.created_at),
  };
}

export async function fetchTextCampaignsByTag(tagId: string): Promise<TextCampaignSummary[]> {
  requireDashboardDataAccess();
  if (!snapshotsDisabled()) {
    const snap = loadTextCampaignsSnapshot(tagId);
    if (snap) return snap.rows;
  }
  const rows = await fetchTextCampaignsByTagUncached(tagId);
  if (!snapshotsDisabled()) saveTextCampaignsSnapshot(tagId, rows);
  return rows;
}

async function fetchTextCampaignsByTagUncached(tagId: string): Promise<TextCampaignSummary[]> {
  const tag = getTagById(tagId);
  if (!tag) return [];

  const whereClause = buildTagWhereClause(tag);

  const sql = `
    SELECT
      campaigns.id AS campaign_id,
      campaigns.name AS campaign_name,
      CAST(campaigns.status AS STRING) AS raw_status,
      COALESCE(campaigns.contact_count, COUNT(campaign_contacts.id)) AS contact_count,
      campaigns.started_at AS started_at,
      campaigns.created_at AS created_at
    FROM \`${P}.${D}.campaigns\` AS campaigns
    LEFT JOIN \`${P}.${D}.campaign_contacts\` AS campaign_contacts
      ON campaigns.id = campaign_contacts.campaign_id
    WHERE ${whereClause}
      AND DATE(campaigns.created_at, 'America/Los_Angeles') >= '${TEXT_WINDOW_START_DATE}'
    GROUP BY
      campaigns.id,
      campaigns.name,
      campaigns.status,
      campaigns.contact_count,
      campaigns.started_at,
      campaigns.created_at
    ORDER BY campaigns.created_at DESC
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);
  return rows.map(rowToTextCampaign);
}

export async function fetchTextContactTagStats(tagId: string): Promise<TextContactTagStat[]> {
  requireDashboardDataAccess();
  if (!snapshotsDisabled()) {
    const snap = loadTextTagStatsSnapshot(tagId);
    if (snap) return snap.rows;
  }
  const rows = await fetchTextContactTagStatsUncached(tagId);
  if (!snapshotsDisabled()) saveTextTagStatsSnapshot(tagId, rows);
  return rows;
}

async function fetchTextContactTagStatsUncached(
  tagId: string,
  campaignIds?: ReadonlySet<string>
): Promise<TextContactTagStat[]> {
  const tag = getTagById(tagId);
  if (!tag) return [];

  const whereClause = buildTagWhereClause(tag);
  const idList = campaignIds ? [...campaignIds].filter((id) => /^[A-Za-z0-9_-]+$/.test(id)) : [];
  if (campaignIds && idList.length === 0) return [];
  const campaignFilter = idList.length
    ? `AND CAST(campaigns.id AS STRING) IN (${idList.map((id) => `'${id}'`).join(", ")})`
    : "";

  const sql = `
    SELECT
      campaigns.id AS campaign_id,
      campaigns.name AS campaign_name,
      tags.name AS tag_name,
      COUNT(*) AS tag_count,
      COUNT(DISTINCT campaign_contact_tags.campaign_contact_id) AS unique_contacts
    FROM \`${P}.${D}.campaign_contact_tags\` AS campaign_contact_tags
    JOIN \`${P}.${D}.tags\` AS tags
      ON tags.id = campaign_contact_tags.tag_id
    JOIN \`${P}.${D}.campaigns\` AS campaigns
      ON campaigns.id = campaign_contact_tags.campaign_id
    WHERE ${whereClause}
      AND campaign_contact_tags.deleted_at IS NULL
      AND tags.deleted_at IS NULL
      AND DATE(campaigns.created_at, 'America/Los_Angeles') >= '${TEXT_WINDOW_START_DATE}'
      ${campaignFilter}
    GROUP BY campaigns.id, campaigns.name, tags.name
    ORDER BY campaigns.name, tag_name
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);
  return rows.map((r) => ({
    campaignId: toStr(r.campaign_id),
    campaignName: toStr(r.campaign_name),
    tagName: toStr(r.tag_name),
    tagCount: toNum(r.tag_count),
    uniqueContacts: toNum(r.unique_contacts),
  }));
}

/** Full text aggregates since the history floor. Not a window slice. */
export async function rebuildTextSnapshotsFromBigQuery(tagId: string): Promise<void> {
  requireDashboardDataAccess();
  if (snapshotsDisabled()) return;
  const [campaigns, stats] = await Promise.all([
    fetchTextCampaignsByTagUncached(tagId),
    fetchTextContactTagStatsUncached(tagId),
  ]);
  saveTextCampaignsSnapshot(tagId, campaigns, { touchEvenIfUnchanged: true });
  saveTextTagStatsSnapshot(tagId, stats, { touchEvenIfUnchanged: true });
}

async function fetchTextCampaignsTouchedSince(
  tagId: string,
  windowStart: string
): Promise<TextCampaignSummary[]> {
  const tag = getTagById(tagId);
  if (!tag) return [];
  const whereClause = buildTagWhereClause(tag);
  const sql = `
    SELECT
      campaigns.id AS campaign_id,
      campaigns.name AS campaign_name,
      CAST(campaigns.status AS STRING) AS raw_status,
      COALESCE(campaigns.contact_count, 0) AS contact_count,
      campaigns.started_at AS started_at,
      campaigns.created_at AS created_at
    FROM \`${P}.${D}.campaigns\` AS campaigns
    WHERE ${whereClause}
      AND DATE(campaigns.created_at, 'America/Los_Angeles') >= '${TEXT_WINDOW_START_DATE}'
      AND (
        ${createdAtOnOrAfterSql("campaigns.created_at", windowStart)}
        OR EXISTS (
          SELECT 1
          FROM \`${P}.${D}.campaign_contacts\` AS campaign_contacts
          WHERE campaign_contacts.campaign_id = campaigns.id
            AND DATE(campaign_contacts.created_at, 'America/Los_Angeles') >= '${windowStart}'
            AND ${createdAtOnOrAfterSql("campaign_contacts.created_at", windowStart)}
        )
        OR EXISTS (
          SELECT 1
          FROM \`${P}.${D}.campaign_contact_tags\` AS campaign_contact_tags
          WHERE campaign_contact_tags.campaign_id = campaigns.id
            AND campaign_contact_tags.deleted_at IS NULL
            AND DATE(campaign_contact_tags.created_at, 'America/Los_Angeles') >= '${windowStart}'
            AND ${createdAtOnOrAfterSql("campaign_contact_tags.created_at", windowStart)}
        )
      )
    ORDER BY campaigns.created_at DESC
  `;
  const rows = await runQuery<Record<string, unknown>>(sql);
  return rows.map(rowToTextCampaign);
}

/** Upsert campaigns and tag rows touched since the refresh window. Does not scan contact JSON. */
export async function refreshTextSnapshotsIncremental(tagId: string, windowStart: string): Promise<void> {
  requireDashboardDataAccess();
  if (snapshotsDisabled()) return;
  const freshCampaigns = await fetchTextCampaignsTouchedSince(tagId, windowStart);
  const existingCampaigns = loadTextCampaignsSnapshot(tagId)?.rows ?? [];
  saveTextCampaignsSnapshot(
    tagId,
    upsertById(existingCampaigns, freshCampaigns, (row) => row.campaignId),
    { touchEvenIfUnchanged: true }
  );
  const activeIds = new Set(freshCampaigns.map((row) => row.campaignId).filter(Boolean));
  if (activeIds.size === 0) return;
  const freshStats = await fetchTextContactTagStatsUncached(tagId, activeIds);
  const existingStats = loadTextTagStatsSnapshot(tagId)?.rows ?? [];
  const kept = existingStats.filter((row) => !activeIds.has(row.campaignId));
  saveTextTagStatsSnapshot(tagId, [...kept, ...freshStats], { touchEvenIfUnchanged: true });
}
