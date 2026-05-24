import { NextResponse } from "next/server";
import {
  getDistrictJob,
  listDistrictReviewRows,
} from "@/lib/district-classifier/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = getDistrictJob(jobId);

  if (!job) {
    return NextResponse.json({ ok: false, error: "District classification job not found.", code: 404 }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: { rows: listDistrictReviewRows(jobId) } });
}
