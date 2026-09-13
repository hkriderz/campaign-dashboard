import { NextRequest } from "next/server";
import { apiError, withApiHandler } from "@/lib/api/http";
import { getTagById, isDerivedQcTagId } from "@/lib/campaign-tags";
import { loadQcRecontactDetail } from "@/lib/queries/qc-recontact";

function firstParam(value: string | null): string {
  return (value ?? "").trim();
}

/**
 * GET /api/phonebanking/[tag]/recontact/[pdiId]?qcCallId=
 * Side-by-side survey answers for one QC recontact pair.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tag: string; pdiId: string }> }
) {
  const { tag: tagId, pdiId } = await params;
  const tag = getTagById(tagId);
  if (!tag) {
    return apiError(`Unknown tag: ${tagId}`, 404);
  }
  if (!isDerivedQcTagId(tagId)) {
    return apiError("Recontact detail is only available on QC Call tags.", 404);
  }

  const qcCallId = firstParam(req.nextUrl.searchParams.get("qcCallId"));
  if (!qcCallId) {
    return apiError("qcCallId is required.", 400);
  }

  return withApiHandler(
    `/api/phonebanking/${tagId}/recontact/${pdiId}`,
    async () => {
      const detail = await loadQcRecontactDetail(tagId, decodeURIComponent(pdiId), qcCallId);
      if (!detail) {
        throw Object.assign(new Error("Recontact pair not found. Refresh this QC tag and try again."), {
          status: 404,
        });
      }
      return detail;
    },
    { req, requireCredentials: { gcp: true } }
  );
}
