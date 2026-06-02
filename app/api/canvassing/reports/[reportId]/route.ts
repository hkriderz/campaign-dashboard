import { NextResponse } from "next/server";
import { deleteCanvassingReport, getCanvassingReport } from "@/lib/canvassing/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ reportId: string }>;
};

export async function GET(_req: Request, { params }: Params) {
  const { reportId } = await params;
  const report = getCanvassingReport(reportId);
  if (!report) {
    return NextResponse.json({ ok: false, error: "Canvassing report not found.", code: 404 }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data: { report } });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { reportId } = await params;
  const deleted = deleteCanvassingReport(reportId);
  if (!deleted) {
    return NextResponse.json({ ok: false, error: "Canvassing report not found.", code: 404 }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data: { deleted: true } });
}
