import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { resolveDistrictExportPath } from "@/lib/district-classifier/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string; fileName: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { jobId, fileName } = await context.params;
  const filePath = resolveDistrictExportPath(jobId, fileName);

  if (!filePath) {
    return NextResponse.json({ ok: false, error: "Export file not found.", code: 404 }, { status: 404 });
  }

  const body = fs.readFileSync(filePath);
  const safeName = path.basename(filePath).replace(/"/g, "");

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}
