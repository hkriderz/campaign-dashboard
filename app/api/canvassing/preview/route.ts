import { NextResponse } from "next/server";
import { analyzeCanvassingParsedFiles } from "@/lib/canvassing/engine";
import { appendKnockEventsToIndex } from "@/lib/canvassing/knock-index-store";
import { buildKnockEvents, parseCanvassingUploadFile } from "@/lib/canvassing/knock-details-parser";
import { readCanvassingUploadFormFiles } from "@/lib/canvassing/upload-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readCanvassingUploadFormFiles(form);
    const parsed = (await Promise.all(files.map((file) => parseCanvassingUploadFile(file)))).flat();
    const result = analyzeCanvassingParsedFiles(parsed);
    const uniqueIdsImport = appendKnockEventsToIndex(buildKnockEvents(parsed).events, {
      source: "knock-analysis",
      fileNames: files.map((file) => file.fileName),
    });
    return NextResponse.json({ ok: true, data: { result, uniqueIdsImport } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/preview POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
