import { NextRequest } from "next/server";
import { apiError, apiOk, errorMessage } from "@/lib/api/http";
import { getTagById } from "@/lib/campaign-tags";
import { fetchPhoneBankDetail } from "@/lib/queries/phonebanking";

/**
 * GET /api/phonebanking/[tag]/[campaignId]
 * Full detail for one phone bank (stats, daily breakdown, date list).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tag: string; campaignId: string }> }
) {
  const { tag: tagId, campaignId } = await params;
  const tag = getTagById(tagId);

  if (!tag) {
    return apiError(`Unknown tag: ${tagId}`, 404);
  }

  try {
    const detail = await fetchPhoneBankDetail(campaignId);
    if (!detail) {
      return apiError(`Campaign not found: ${campaignId}`, 404);
    }
    return apiOk(detail);
  } catch (err) {
    const message = errorMessage(err);
    console.error(`[/api/phonebanking/${tagId}/${campaignId}]`, message);
    return apiError(message, 500);
  }
}
