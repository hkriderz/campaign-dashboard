import { NextResponse } from "next/server";
import { analyzeCanvassingUploads } from "@/lib/canvassing/engine";
import { listCanvassingReports, saveCanvassingReport } from "@/lib/canvassing/store";
import { readCanvassingUploadFormFiles } from "@/lib/canvassing/upload-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanReportName(raw: FormDataEntryValue | null): string {
  const name = raw?.toString()?.trim() ?? "";
  if (name.length > 120) return name.slice(0, 120);
  return name;
}

function cleanReportDate(raw: FormDataEntryValue | null): string {
  const value = raw?.toString()?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export async function GET() {
  return NextResponse.json({ ok: true, data: { reports: listCanvassingReports() } });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readCanvassingUploadFormFiles(form);
    const result = await analyzeCanvassingUploads(files);
    const report = saveCanvassingReport({
      name: cleanReportName(form.get("name")),
      reportDate: cleanReportDate(form.get("reportDate")),
      result,
    });

    return NextResponse.json({ ok: true, data: { report } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/reports POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
