import { NextRequest } from "next/server";
import { apiError, withApiHandler } from "@/lib/api/http";
import { getTagById } from "@/lib/campaign-tags";
import { fetchPhoneBanksByTag } from "@/lib/queries/phonebanking";

/**
 * GET /api/phonebanking/[tag]
 * Returns all phone banks (campaigns) matching the given candidate tag.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tag: string }> }
) {
  const { tag: tagId } = await params;
  const tag = getTagById(tagId);

  if (!tag) {
    return apiError(`Unknown tag: ${tagId}`, 404);
  }

  return withApiHandler(`/api/phonebanking/${tagId}`, async () => {
    const phoneBanks = await fetchPhoneBanksByTag(tagId);
    return { tag, phoneBanks };
  });
}
