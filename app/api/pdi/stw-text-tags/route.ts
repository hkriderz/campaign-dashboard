import { NextResponse } from "next/server";
import { withCredentialContext } from "@/lib/credentials";
import { runQuery } from "@/lib/bigquery";
import { buildNithyaTextCampaignStwData } from "@/lib/pdi-tools/text-tag-stw-data";
import { buildTextTagCatalogQuery } from "@/lib/pdi-tools/sync/text-query";
import { TEXT_MAPPING_SURVEY_NAME } from "@/lib/pdi-tools/channel";

export const GET = withCredentialContext(
  async () => {
    const rows = await runQuery<{ campaign_name: string; tag_name: string }>(buildTextTagCatalogQuery());
    const catalogRows = rows.map((r) => ({
      campaignName: String(r.campaign_name ?? "").trim(),
      tagName: String(r.tag_name ?? "").trim(),
    }));
    const surveys = buildNithyaTextCampaignStwData(catalogRows);
    return NextResponse.json(
      {
        surveys,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        campaignCount: Object.keys(surveys).length,
        tagCount: catalogRows.filter((r) => r.tagName).length,
      },
      { status: 200 }
    );
  },
  { gcp: true }
);
