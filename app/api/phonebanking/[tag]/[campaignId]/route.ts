import { NextRequest } from "next/server";
import { apiError, withApiHandler } from "@/lib/api/http";
import { getTagById } from "@/lib/campaign-tags";
import { fetchPhoneBankDetail } from "@/lib/queries/phonebanking";

/**
 * GET /api/phonebanking/[tag]/[campaignId]
 * Full detail for one phone bank (stats, daily breakdown, date list).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tag: string; campaignId: string }> }
) {
  const { tag: tagId, campaignId } = await params;
  const tag = getTagById(tagId);

  if (!tag) {
    return apiError(`Unknown tag: ${tagId}`, 404);
  }

  return withApiHandler(
    `/api/phonebanking/${tagId}/${campaignId}`,
    async () => {
      const detail = await fetchPhoneBankDetail(campaignId);
      if (!detail) {
        throw new Error(`Campaign not found: ${campaignId}`);
      }
      return detail;
    },
    { req, requireCredentials: { gcp: true } }
  );
}
