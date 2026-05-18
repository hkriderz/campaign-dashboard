import { NextRequest, NextResponse } from "next/server";
import { prepareWidePbCsvFromText } from "@/lib/wide-csv-prepare";

/**
 * POST multipart: file (wide PB crosstab CSV), tag? (column hints)
 * Returns the same prepare payload as stw-convert for the shared import UI.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const tagId = form.get("tag")?.toString()?.trim() ?? "";

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const text = await file.text();
    const data = prepareWidePbCsvFromText(text, tagId);

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
