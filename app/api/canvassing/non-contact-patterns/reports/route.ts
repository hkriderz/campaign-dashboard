import { NextResponse } from "next/server";
import { analyzeNonContactPatternUploads } from "@/lib/canvassing/non-contact-patterns/analyzer";
import {
  listNonContactPatternReports,
  saveNonContactPatternReports,
} from "@/lib/canvassing/non-contact-patterns/store";
import {
  parseNonContactSettingsFormValue,
  readNonContactUploadFormFiles,
} from "@/lib/canvassing/non-contact-patterns/upload-form";
import type { NonContactPatternSettings } from "@/lib/canvassing/non-contact-patterns/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanReportName(raw: FormDataEntryValue | null): string {
  const name = raw?.toString()?.trim() ?? "";
  return name.length > 120 ? name.slice(0, 120) : name;
}

export async function GET() {
  return NextResponse.json({ ok: true, data: { reports: listNonContactPatternReports() } });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readNonContactUploadFormFiles(form);
    const settings = parseNonContactSettingsFormValue(form.get("settings")) as Partial<NonContactPatternSettings> | null;
    const ingestion = await analyzeNonContactPatternUploads(files, settings ?? undefined);
    const namePrefix = cleanReportName(form.get("name")) || "Non-contact patterns";
    const reports = saveNonContactPatternReports({
      namePrefix,
      results: ingestion.results,
    });
    return NextResponse.json(
      {
        ok: true,
        data: {
          reports,
          report: reports[reports.length - 1] ?? null,
          splitByDate: ingestion.splitByDate,
          distinctDates: ingestion.distinctDates,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/non-contact-patterns/reports POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
