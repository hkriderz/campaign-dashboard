import { NextResponse } from "next/server";
import { analyzeDoorknockResultUploads } from "@/lib/canvassing/doorknocks-results/analyzer";
import { listDoorknockReports, saveDoorknockReport } from "@/lib/canvassing/doorknocks-results/store";
import {
  parseDoorknockSettingsFormValue,
  readDoorknockUploadFormFiles,
} from "@/lib/canvassing/doorknocks-results/upload-form";
import type { DoorknockSummarySettings } from "@/lib/canvassing/doorknocks-results/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanReportName(raw: FormDataEntryValue | null): string {
  const name = raw?.toString()?.trim() ?? "";
  return name.length > 120 ? name.slice(0, 120) : name;
}

export async function GET() {
  return NextResponse.json({ ok: true, data: { reports: listDoorknockReports() } });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readDoorknockUploadFormFiles(form);
    const settings = parseDoorknockSettingsFormValue(form.get("settings")) as Partial<DoorknockSummarySettings> | null;
    const result = await analyzeDoorknockResultUploads(files, settings);
    const report = saveDoorknockReport({
      name: cleanReportName(form.get("name")),
      result,
    });
    return NextResponse.json({ ok: true, data: { report } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/doorknocks-results/reports POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
