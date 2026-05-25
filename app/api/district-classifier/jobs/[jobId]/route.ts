import { NextResponse } from "next/server";
import { getDistrictJob, markStaleDistrictJobsFailed } from "@/lib/district-classifier/store";
import { cancelDistrictClassificationJob } from "@/lib/district-classifier/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { jobId } = await context.params;
  markStaleDistrictJobsFailed();
  const job = getDistrictJob(jobId);

  if (!job) {
    return NextResponse.json({ ok: false, error: "District classification job not found.", code: 404 }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: { job } });
}

export async function PATCH(req: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = getDistrictJob(jobId);

  if (!job) {
    return NextResponse.json({ ok: false, error: "District classification job not found.", code: 404 }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "cancel") {
    return NextResponse.json({ ok: false, error: "Unsupported job action.", code: 400 }, { status: 400 });
  }

  if (job.status === "completed" || job.status === "failed") {
    return NextResponse.json({ ok: true, data: { job } });
  }

  cancelDistrictClassificationJob(jobId);
  const updated = getDistrictJob(jobId);
  return NextResponse.json({ ok: true, data: { job: updated ?? job } });
}
