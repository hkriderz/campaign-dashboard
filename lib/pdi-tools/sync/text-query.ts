import { PROJECT, TEXT_DATASET } from "@/lib/bigquery";
import { pdiIdExtractSql } from "./pdi-id-sql";

const P = PROJECT;
const D = TEXT_DATASET;

export const TEXT_PDI_ID_SQL = pdiIdExtractSql("campaign_contacts.data");

/**
 * Every text campaign that has at least one tag.
 * Same listing rule as the dialer mapper (any name, no created-date cutoff),
 * scoped to `l11_stw_txt` campaigns and tags.
 */
export function buildTextTagCatalogQuery(): string {
  return `
    SELECT DISTINCT
      campaigns.name AS campaign_name,
      tags.name AS tag_name
    FROM \`${P}.${D}.campaigns\` AS campaigns
    JOIN \`${P}.${D}.campaign_contact_tags\` AS campaign_contact_tags
      ON campaign_contact_tags.campaign_id = campaigns.id
      AND campaign_contact_tags.deleted_at IS NULL
    JOIN \`${P}.${D}.tags\` AS tags
      ON tags.id = campaign_contact_tags.tag_id
      AND tags.deleted_at IS NULL
    WHERE campaigns.name IS NOT NULL
      AND TRIM(campaigns.name) != ""
      AND tags.name IS NOT NULL
      AND TRIM(tags.name) != ""
    ORDER BY campaign_name, tag_name
  `.trim();
}

/**
 * Tagged contacts with an extractable PDI id, for every text campaign.
 * `answer_value` is the raw STW tag name. The engine classifies Nithya Mayor
 * and Moved tags, keeps other tags under Other, then keeps the latest status
 * per person, campaign, and question.
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
      WHERE campaign_contact_tags.deleted_at IS NULL
        AND tags.deleted_at IS NULL
        AND campaigns.name IS NOT NULL
        AND TRIM(campaigns.name) != ""
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
