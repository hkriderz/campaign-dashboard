import { PROJECT, TEXT_DATASET, runQuery } from "../bigquery";
import { buildTagWhereClause } from "../campaign-tags";
import {
  lookupTextContactPdi,
  mergeTextContactPdiIndex,
  textPdiIndexWindowStart,
} from "../bq-identity-index";
import { canonicalizePhonebankerName } from "../phonebanker-name";
import { selectPdiIdFromJson } from "../pdi-tools/sync/pdi-id-sql";
import { TEXT_PDI_ID_SQL } from "../pdi-tools/sync/text-query";
import { pickTextResultLabel } from "../qc-recontact/text";
import type { QcRecontactTextMessage, QcTextContactSummary } from "../qc-recontact/types";
import { createdAtOnOrAfterSql } from "../snapshot-merge";
import type { CampaignTag, SurveyScriptProfile } from "../types";
import { toNum, toStr } from "./bq-row-parsers";

const P = PROJECT;
const D = TEXT_DATASET;
const TEXT_WINDOW_START_DATE = "2025-12-01";

type TextContactRow = {
  campaign_contact_id: unknown;
  campaign_id: unknown;
  campaign_name: unknown;
  pdi_id: unknown;
  last_message_at: unknown;
  inbound_count: unknown;
  texter_name: unknown;
  tags: unknown;
};

function occurredOnFromStamp(stamp: string): string {
  const trimmed = stamp.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return "";
}

function parseTagList(val: unknown): Array<{ tagName: string; tagAt: string }> {
  if (!Array.isArray(val)) return [];
  const out: Array<{ tagName: string; tagAt: string }> = [];
  for (const item of val) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const tagName = toStr(rec.tag_name ?? rec.tagName);
    if (!tagName) continue;
    out.push({ tagName, tagAt: toStr(rec.tagged_at ?? rec.tagAt ?? rec.tag_at) });
  }
  return out;
}

/**
 * Compact STW Text contacts with PDI for one candidate tag.
 * Conversation bodies are not loaded here — the modal fetches them by campaign_contact_id.
 * A window refresh reads messages and tags since `activeSince` and does not select contact JSON.
 */
export async function fetchTagTextContacts(
  tag: CampaignTag,
  profile: SurveyScriptProfile,
  options?: { activeSince?: string; queryStartedAt?: string }
): Promise<QcTextContactSummary[]> {
  const activeSince = /^\d{4}-\d{2}-\d{2}$/.test(options?.activeSince ?? "") ? options!.activeSince! : "";
  if (activeSince) {
    return fetchTagTextContactsInWindow(tag, profile, activeSince);
  }
  const rows = await fetchTagTextContactsFull(tag, profile);
  if (options?.queryStartedAt) {
    mergeTextContactPdiIndex(
      rows.map((row) => ({ contactId: row.campaignContactId, pdiId: row.pdiId })),
      options.queryStartedAt
    );
  }
  return rows;
}

const textPdiCatchUpFor = new Set<string>();

/** Append contact JSON created since the index watermark. Historical JSON stays unread. */
export async function appendTextContactPdiCatchUp(queryStartedAt: string): Promise<void> {
  if (textPdiCatchUpFor.has(queryStartedAt)) return;
  const windowStart = textPdiIndexWindowStart();
  if (!windowStart) return;
  const sql = `
    SELECT
      CAST(id AS STRING) AS contact_id,
      COALESCE(data, '') AS contact_data
    FROM \`${P}.${D}.campaign_contacts\`
    WHERE DATE(created_at, 'America/Los_Angeles') >= '${windowStart}'
      AND ${createdAtOnOrAfterSql("created_at", windowStart)}
  `;
  const rows = await runQuery<Record<string, unknown>>(sql);
  mergeTextContactPdiIndex(
    rows.map((row) => ({
      contactId: toStr(row.contact_id),
      pdiId: selectPdiIdFromJson(toStr(row.contact_data)),
    })),
    queryStartedAt
  );
  textPdiCatchUpFor.add(queryStartedAt);
}

async function fetchTagTextContactsInWindow(
  tag: CampaignTag,
  profile: SurveyScriptProfile,
  activeSince: string
): Promise<QcTextContactSummary[]> {
  const whereClause = buildTagWhereClause(tag);
  const contactSql = `
    WITH msg AS (
      SELECT
        messages.campaign_contact_id,
        campaigns.id AS campaign_id,
        campaigns.name AS campaign_name,
        FORMAT_DATETIME(
          '%Y-%m-%dT%H:%M:%S',
          DATETIME(MAX(COALESCE(messages.thread_order_time, messages.created_at)), 'America/Los_Angeles')
        ) AS last_message_at,
        COUNTIF(UPPER(CAST(messages.direction AS STRING)) = 'INBOUND') AS inbound_count,
        IFNULL(
          ARRAY_AGG(
            CAST(messages.created_by_user_id AS STRING) IGNORE NULLS
            ORDER BY COALESCE(messages.thread_order_time, messages.created_at) DESC
            LIMIT 1
          ),
          CAST([] AS ARRAY<STRING>)
        )[SAFE_OFFSET(0)] AS texter_user_id
      FROM \`${P}.${D}.messages\` AS messages
      JOIN \`${P}.${D}.campaign_contacts\` AS campaign_contacts
        ON campaign_contacts.id = messages.campaign_contact_id
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON campaigns.id = campaign_contacts.campaign_id
      WHERE ${whereClause}
        AND DATE(campaigns.created_at, 'America/Los_Angeles') >= '${TEXT_WINDOW_START_DATE}'
        AND DATE(COALESCE(messages.thread_order_time, messages.created_at), 'America/Los_Angeles') >= '${activeSince}'
        AND ${createdAtOnOrAfterSql("messages.created_at", activeSince)}
      GROUP BY messages.campaign_contact_id, campaigns.id, campaigns.name
    ),
    tagged AS (
      SELECT
        campaign_contact_tags.campaign_contact_id,
        campaigns.id AS campaign_id,
        campaigns.name AS campaign_name,
        ARRAY_AGG(
          STRUCT(
            tags.name AS tag_name,
            FORMAT_DATETIME(
              '%Y-%m-%dT%H:%M:%S',
              DATETIME(campaign_contact_tags.created_at, 'America/Los_Angeles')
            ) AS tagged_at
          )
          IGNORE NULLS
          ORDER BY campaign_contact_tags.created_at DESC
        ) AS tags,
        IFNULL(
          ARRAY_AGG(
            CAST(campaign_contact_tags.created_by_id AS STRING) IGNORE NULLS
            ORDER BY campaign_contact_tags.created_at DESC
            LIMIT 1
          ),
          CAST([] AS ARRAY<STRING>)
        )[SAFE_OFFSET(0)] AS tag_user_id
      FROM \`${P}.${D}.campaign_contact_tags\` AS campaign_contact_tags
      JOIN \`${P}.${D}.tags\` AS tags
        ON tags.id = campaign_contact_tags.tag_id
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON campaigns.id = campaign_contact_tags.campaign_id
      WHERE ${whereClause}
        AND campaign_contact_tags.deleted_at IS NULL
        AND tags.deleted_at IS NULL
        AND DATE(campaigns.created_at, 'America/Los_Angeles') >= '${TEXT_WINDOW_START_DATE}'
        AND DATE(campaign_contact_tags.created_at, 'America/Los_Angeles') >= '${activeSince}'
        AND ${createdAtOnOrAfterSql("campaign_contact_tags.created_at", activeSince)}
      GROUP BY campaign_contact_tags.campaign_contact_id, campaigns.id, campaigns.name
    )
    SELECT
      CAST(COALESCE(msg.campaign_contact_id, tagged.campaign_contact_id) AS STRING) AS campaign_contact_id,
      CAST(COALESCE(msg.campaign_id, tagged.campaign_id) AS STRING) AS campaign_id,
      COALESCE(msg.campaign_name, tagged.campaign_name) AS campaign_name,
      msg.last_message_at,
      IFNULL(msg.inbound_count, 0) AS inbound_count,
      COALESCE(msg_users.full_name, tag_users.full_name, "") AS texter_name,
      IFNULL(tagged.tags, CAST([] AS ARRAY<STRUCT<tag_name STRING, tagged_at STRING>>)) AS tags
    FROM msg
    FULL OUTER JOIN tagged
      ON tagged.campaign_contact_id = msg.campaign_contact_id
    LEFT JOIN \`${P}.${D}.users\` AS msg_users
      ON msg_users.id = msg.texter_user_id
    LEFT JOIN \`${P}.${D}.users\` AS tag_users
      ON tag_users.id = tagged.tag_user_id
  `;

  const contactRows = await runQuery<TextContactRow>(contactSql);
  return contactRowsToSummaries(contactRows, tag, profile, true);
}

async function fetchTagTextContactsFull(
  tag: CampaignTag,
  profile: SurveyScriptProfile
): Promise<QcTextContactSummary[]> {
  const whereClause = buildTagWhereClause(tag);
  const pdiSql = TEXT_PDI_ID_SQL;

  const contactSql = `
    WITH base AS (
      SELECT
        campaign_contacts.id AS campaign_contact_id,
        campaigns.id AS campaign_id,
        campaigns.name AS campaign_name,
        TRIM(IFNULL(${pdiSql}, "")) AS pdi_id
      FROM \`${P}.${D}.campaign_contacts\` AS campaign_contacts
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON campaigns.id = campaign_contacts.campaign_id
      WHERE ${whereClause}
        AND DATE(campaigns.created_at, 'America/Los_Angeles') >= '${TEXT_WINDOW_START_DATE}'
        AND TRIM(IFNULL(${pdiSql}, "")) != ""
        AND (
          EXISTS (
            SELECT 1
            FROM \`${P}.${D}.messages\` AS messages
            WHERE messages.campaign_contact_id = campaign_contacts.id
          )
          OR EXISTS (
            SELECT 1
            FROM \`${P}.${D}.campaign_contact_tags\` AS campaign_contact_tags
            WHERE campaign_contact_tags.campaign_contact_id = campaign_contacts.id
              AND campaign_contact_tags.deleted_at IS NULL
          )
        )
    ),
    msg AS (
      SELECT
        messages.campaign_contact_id,
        FORMAT_DATETIME(
          '%Y-%m-%dT%H:%M:%S',
          DATETIME(MAX(COALESCE(messages.thread_order_time, messages.created_at)), 'America/Los_Angeles')
        ) AS last_message_at,
        COUNTIF(UPPER(CAST(messages.direction AS STRING)) = 'INBOUND') AS inbound_count,
        IFNULL(
          ARRAY_AGG(
            CAST(messages.created_by_user_id AS STRING) IGNORE NULLS
            ORDER BY COALESCE(messages.thread_order_time, messages.created_at) DESC
            LIMIT 1
          ),
          CAST([] AS ARRAY<STRING>)
        )[SAFE_OFFSET(0)] AS texter_user_id
      FROM \`${P}.${D}.messages\` AS messages
      JOIN base ON base.campaign_contact_id = messages.campaign_contact_id
      GROUP BY messages.campaign_contact_id
    ),
    tagged AS (
      SELECT
        campaign_contact_tags.campaign_contact_id,
        ARRAY_AGG(
          STRUCT(
            tags.name AS tag_name,
            FORMAT_DATETIME(
              '%Y-%m-%dT%H:%M:%S',
              DATETIME(campaign_contact_tags.created_at, 'America/Los_Angeles')
            ) AS tagged_at
          )
          IGNORE NULLS
          ORDER BY campaign_contact_tags.created_at DESC
        ) AS tags,
        IFNULL(
          ARRAY_AGG(
            CAST(campaign_contact_tags.created_by_id AS STRING) IGNORE NULLS
            ORDER BY campaign_contact_tags.created_at DESC
            LIMIT 1
          ),
          CAST([] AS ARRAY<STRING>)
        )[SAFE_OFFSET(0)] AS tag_user_id
      FROM \`${P}.${D}.campaign_contact_tags\` AS campaign_contact_tags
      JOIN \`${P}.${D}.tags\` AS tags
        ON tags.id = campaign_contact_tags.tag_id
      JOIN base ON base.campaign_contact_id = campaign_contact_tags.campaign_contact_id
      WHERE campaign_contact_tags.deleted_at IS NULL
        AND tags.deleted_at IS NULL
      GROUP BY campaign_contact_tags.campaign_contact_id
    )
    SELECT
      CAST(base.campaign_contact_id AS STRING) AS campaign_contact_id,
      CAST(base.campaign_id AS STRING) AS campaign_id,
      base.campaign_name,
      base.pdi_id,
      msg.last_message_at,
      IFNULL(msg.inbound_count, 0) AS inbound_count,
      COALESCE(msg_users.full_name, tag_users.full_name, "") AS texter_name,
      IFNULL(tagged.tags, CAST([] AS ARRAY<STRUCT<tag_name STRING, tagged_at STRING>>)) AS tags
    FROM base
    LEFT JOIN msg ON msg.campaign_contact_id = base.campaign_contact_id
    LEFT JOIN tagged ON tagged.campaign_contact_id = base.campaign_contact_id
    LEFT JOIN \`${P}.${D}.users\` AS msg_users
      ON msg_users.id = msg.texter_user_id
    LEFT JOIN \`${P}.${D}.users\` AS tag_users
      ON tag_users.id = tagged.tag_user_id
  `;

  const contactRows = await runQuery<TextContactRow>(contactSql);
  return contactRowsToSummaries(contactRows, tag, profile, false);
}

function contactRowsToSummaries(
  contactRows: TextContactRow[],
  tag: CampaignTag,
  profile: SurveyScriptProfile,
  fromWindow: boolean
): QcTextContactSummary[] {
  const out: QcTextContactSummary[] = [];
  for (const row of contactRows) {
    const campaignContactId = toStr(row.campaign_contact_id);
    if (!campaignContactId) continue;
    const tags = parseTagList(row.tags);
    const lastMessageAt = toStr(row.last_message_at);
    const latestTagAt = tags[0]?.tagAt ?? "";
    const occurredAt = lastMessageAt || latestTagAt;
    if (!occurredAt) continue;
    const resultLabel = pickTextResultLabel(
      tags.map((item) => item.tagName),
      tag.id,
      profile
    );
    const queriedPdi = toStr(row.pdi_id);
    out.push({
      campaignContactId,
      campaignId: toStr(row.campaign_id),
      campaignName: toStr(row.campaign_name),
      pdiId: fromWindow ? lookupTextContactPdi(campaignContactId) || queriedPdi : queriedPdi,
      texterName: canonicalizePhonebankerName(toStr(row.texter_name)),
      occurredOn: occurredOnFromStamp(occurredAt),
      occurredAt,
      resultLabel,
      hasMessages: Boolean(lastMessageAt),
      hasInboundReply: toNum(row.inbound_count) > 0,
    });
  }
  return out;
}

function isSafeContactId(value: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(value);
}

/** Live conversation for one STW Text campaign contact. */
export async function fetchTextConversation(campaignContactId: string): Promise<QcRecontactTextMessage[]> {
  const id = campaignContactId.trim();
  if (!isSafeContactId(id)) return [];

  const sql = `
    SELECT
      FORMAT_DATETIME(
        '%Y-%m-%dT%H:%M:%S',
        DATETIME(COALESCE(messages.thread_order_time, messages.created_at), 'America/Los_Angeles')
      ) AS occurred_at,
      CAST(messages.direction AS STRING) AS direction,
      IFNULL(messages.text, "") AS body,
      IFNULL(users.full_name, "") AS actor_name
    FROM \`${P}.${D}.messages\` AS messages
    LEFT JOIN \`${P}.${D}.users\` AS users
      ON users.id = messages.created_by_user_id
    WHERE CAST(messages.campaign_contact_id AS STRING) = '${id}'
    ORDER BY COALESCE(messages.thread_order_time, messages.created_at) ASC, messages.id ASC
  `;

  const rows = await runQuery<Record<string, unknown>>(sql);
  return rows.map((row) => {
    const direction = toStr(row.direction).toUpperCase() === "INBOUND" ? "inbound" : "outbound";
    const actor = canonicalizePhonebankerName(toStr(row.actor_name));
    return {
      at: toStr(row.occurred_at ?? row.at),
      direction,
      body: toStr(row.body),
      actorName: actor || (direction === "inbound" ? "Voter" : "Texter"),
    };
  });
}
