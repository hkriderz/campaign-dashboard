import { NextResponse } from "next/server";
import { analyzeDoorknockResultUploads } from "@/lib/canvassing/doorknocks-results/analyzer";
import {
  parseDoorknockSettingsFormValue,
  readDoorknockUploadFormFiles,
} from "@/lib/canvassing/doorknocks-results/upload-form";
import type { DoorknockSummarySettings } from "@/lib/canvassing/doorknocks-results/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readDoorknockUploadFormFiles(form);
    const settings = parseDoorknockSettingsFormValue(form.get("settings")) as Partial<DoorknockSummarySettings> | null;
    const result = await analyzeDoorknockResultUploads(files, settings);
    return NextResponse.json({ ok: true, data: { result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/doorknocks-results/preview POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
