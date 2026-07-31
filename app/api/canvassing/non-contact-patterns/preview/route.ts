import { NextResponse } from "next/server";
import { analyzeNonContactPatternUploads } from "@/lib/canvassing/non-contact-patterns/analyzer";
import {
  parseNonContactSettingsFormValue,
  readNonContactUploadFormFiles,
} from "@/lib/canvassing/non-contact-patterns/upload-form";
import type { NonContactPatternSettings } from "@/lib/canvassing/non-contact-patterns/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readNonContactUploadFormFiles(form);
    const settings = parseNonContactSettingsFormValue(form.get("settings")) as Partial<NonContactPatternSettings> | null;
    const ingestion = await analyzeNonContactPatternUploads(files, settings ?? undefined);
    return NextResponse.json({
      ok: true,
      data: {
        ingestion,
        // Convenience: primary/latest result for single-day uploads
        result: ingestion.results[ingestion.results.length - 1] ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/non-contact-patterns/preview POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
