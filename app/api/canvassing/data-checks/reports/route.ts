import { NextResponse } from "next/server";
import { analyzePendingApprovalUploads } from "@/lib/canvassing/data-checks/analyzer";
import { listDataChecksReports, saveDataChecksReport } from "@/lib/canvassing/data-checks/store";
import {
  parseDataChecksSettingsFormValue,
  readDataChecksUploadFormFiles,
} from "@/lib/canvassing/data-checks/upload-form";
import type { DoorknockSummarySettings } from "@/lib/canvassing/doorknocks-results/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanReportName(raw: FormDataEntryValue | null): string {
  const name = raw?.toString()?.trim() ?? "";
  return name.length > 120 ? name.slice(0, 120) : name;
}

export async function GET() {
  return NextResponse.json({ ok: true, data: { reports: listDataChecksReports() } });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readDataChecksUploadFormFiles(form);
    const settings = parseDataChecksSettingsFormValue(form.get("settings")) as Partial<DoorknockSummarySettings> | null;
    const result = await analyzePendingApprovalUploads(files, settings);
    const report = saveDataChecksReport({
      name: cleanReportName(form.get("name")),
      result,
    });
    return NextResponse.json({ ok: true, data: { report } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/data-checks/reports POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
