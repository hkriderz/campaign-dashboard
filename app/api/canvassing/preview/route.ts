import { NextResponse } from "next/server";
import { analyzeCanvassingUploads } from "@/lib/canvassing/engine";
import { readCanvassingUploadFormFiles } from "@/lib/canvassing/upload-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readCanvassingUploadFormFiles(form);
    const result = await analyzeCanvassingUploads(files);
    return NextResponse.json({ ok: true, data: { result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/preview POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
