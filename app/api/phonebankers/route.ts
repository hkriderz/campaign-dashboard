import { NextRequest } from "next/server";
import { apiError, requireQueryParam, withApiHandler } from "@/lib/api/http";
import { getTagById } from "@/lib/campaign-tags";
import { fetchPhonebankersByTag } from "@/lib/queries/phonebanking";

/**
 * GET /api/phonebankers?tag=faizah
 * GET /api/phonebankers?tag=faizah&date=2026-05-01
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const tagIdOrError = requireQueryParam(searchParams, "tag");
  if (typeof tagIdOrError !== "string") return tagIdOrError;

  const tagId = tagIdOrError;
  const date = searchParams.get("date")?.trim() || undefined;

  const tag = getTagById(tagId);
  if (!tag) {
    return apiError(`Unknown tag: ${tagId}`, 404);
  }

  return withApiHandler("/api/phonebankers", async () => {
    const phonebankers = await fetchPhonebankersByTag(tagId, date);
    return { tag, phonebankers, date: date ?? null };
  });
}
