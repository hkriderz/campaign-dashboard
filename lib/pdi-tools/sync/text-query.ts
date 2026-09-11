import { PROJECT, TEXT_DATASET } from "@/lib/bigquery";
import { buildTagWhereClause, getTagById } from "@/lib/campaign-tags";
import { TEXT_CANDIDATE_TAG_ID } from "@/lib/pdi-tools/channel";

const TEXT_WINDOW_START_DATE = "2025-12-01";

const P = PROJECT;
const D = TEXT_DATASET;

export const TEXT_PDI_ID_SQL = `
COALESCE(
  REGEXP_EXTRACT(campaign_contacts.data, r'(?i)"v1_pdiid"\\s*:\\s*"([^"]+)"'),
  REGEXP_EXTRACT(campaign_contacts.data, r'(?i)"pdi_id"\\s*:\\s*"([^"]+)"'),
  REGEXP_EXTRACT(campaign_contacts.data, r'(?i)"pdi id"\\s*:\\s*"([^"]+)"'),
  REGEXP_EXTRACT(campaign_contacts.data, r'(?i)"[^"]*pdi[ _]?id[^"]*"\\s*:\\s*"([^"]+)"')
)
`.trim();

function nithyaCampaignWhere(): string {
  const tag = getTagById(TEXT_CANDIDATE_TAG_ID);
  if (!tag) {
    throw new Error('Campaign tag "nithya" is not configured.');
  }
  return buildTagWhereClause(tag);
}

/** All Nithya text campaigns plus any Support/Moved tags (untagged lists still appear). */
export function buildTextTagCatalogQuery(): string {
  return `
    SELECT DISTINCT
      campaigns.name AS campaign_name,
      tags.name AS tag_name
    FROM \`${P}.${D}.campaigns\` AS campaigns
    LEFT JOIN \`${P}.${D}.campaign_contact_tags\` AS campaign_contact_tags
      ON campaign_contact_tags.campaign_id = campaigns.id
      AND campaign_contact_tags.deleted_at IS NULL
    LEFT JOIN \`${P}.${D}.tags\` AS tags
      ON tags.id = campaign_contact_tags.tag_id
      AND tags.deleted_at IS NULL
    WHERE ${nithyaCampaignWhere()}
      AND campaigns.name IS NOT NULL
      AND TRIM(campaigns.name) != ""
      AND DATE(campaigns.created_at, 'America/Los_Angeles') >= '${TEXT_WINDOW_START_DATE}'
    ORDER BY campaign_name, tag_name
  `.trim();
}

/**
 * Tagged Nithya contacts with an extractable PDI id.
 * `answer_value` is the raw STW tag name; the engine classifies Support/Moved after fetch.
 */
export function buildTextTagQuery(startIso: string, endIso: string): string {
  const startStr = startIso.slice(0, 19).replace("T", " ");
  const endStr = endIso.slice(0, 19).replace("T", " ");

  return `
    WITH base AS (
      SELECT
        campaigns.name AS campaign_name,
        tags.name AS answer_value,
        DATETIME(COALESCE(
          campaign_contact_tags.created_at,
          campaigns.started_at,
          campaigns.created_at
        )) AS call_time,
        IFNULL(${TEXT_PDI_ID_SQL}, "") AS pdi_id
      FROM \`${P}.${D}.campaign_contact_tags\` AS campaign_contact_tags
      JOIN \`${P}.${D}.tags\` AS tags
        ON tags.id = campaign_contact_tags.tag_id
      JOIN \`${P}.${D}.campaigns\` AS campaigns
        ON campaigns.id = campaign_contact_tags.campaign_id
      JOIN \`${P}.${D}.campaign_contacts\` AS campaign_contacts
        ON campaign_contacts.id = campaign_contact_tags.campaign_contact_id
      WHERE ${nithyaCampaignWhere()}
        AND campaign_contact_tags.deleted_at IS NULL
        AND tags.deleted_at IS NULL
        AND tags.name IS NOT NULL
        AND TRIM(tags.name) != ""
    )
    SELECT
      campaign_name,
      answer_value,
      call_time,
      TRIM(pdi_id) AS pdi_id
    FROM base
    WHERE
      call_time >= '${startStr}'
      AND call_time < '${endStr}'
      AND TRIM(pdi_id) != ""
  `.trim();
}
