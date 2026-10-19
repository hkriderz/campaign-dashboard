import { NextResponse } from "next/server";
import { deleteDataChecksReport, getDataChecksReport } from "@/lib/canvassing/data-checks/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ reportId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { reportId } = await context.params;
  const report = getDataChecksReport(reportId);
  if (!report) {
    return NextResponse.json({ ok: false, error: "Data checks report not found.", code: 404 }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data: { report } });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { reportId } = await context.params;
  const deleted = deleteDataChecksReport(reportId);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "Data checks report not found.", code: 404 }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data: { deleted: true } });
}
