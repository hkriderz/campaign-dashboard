import { NextResponse } from "next/server";
import { analyzePendingApprovalUploads } from "@/lib/canvassing/data-checks/analyzer";
import {
  parseDataChecksSettingsFormValue,
  readDataChecksUploadFormFiles,
} from "@/lib/canvassing/data-checks/upload-form";
import type { DoorknockSummarySettings } from "@/lib/canvassing/doorknocks-results/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readDataChecksUploadFormFiles(form);
    const settings = parseDataChecksSettingsFormValue(form.get("settings")) as Partial<DoorknockSummarySettings> | null;
    const result = await analyzePendingApprovalUploads(files, settings);
    return NextResponse.json({ ok: true, data: { result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/data-checks/preview POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
