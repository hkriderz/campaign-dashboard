import { PROJECT, TEXT_DATASET, runQuery } from "../bigquery";
import { buildTagWhereClause } from "../campaign-tags";
import { canonicalizePhonebankerName } from "../phonebanker-name";
import { TEXT_PDI_ID_SQL } from "../pdi-tools/sync/text-query";
import { pickTextResultLabel } from "../qc-recontact/text";
import type { QcRecontactTextMessage, QcTextContactSummary } from "../qc-recontact/types";
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
 */
export async function fetchTagTextContacts(
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
    out.push({
      campaignContactId,
      campaignId: toStr(row.campaign_id),
      campaignName: toStr(row.campaign_name),
      pdiId: toStr(row.pdi_id),
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
