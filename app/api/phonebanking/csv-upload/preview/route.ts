import { NextResponse } from "next/server";
import { detectPbCsvUploadKind, parsePhoneBankCsvForUpload } from "@/lib/csv-upload-parse";
import { summarizeRowsForUploadUi } from "@/lib/csv-store";

/**
 * POST multipart: file (required). Parses CSV and returns date/slice scan without saving.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }
    const csvText = await file.text();
    const csvKind = detectPbCsvUploadKind(csvText);
    const rows = parsePhoneBankCsvForUpload(csvText, { preview: true });
    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "No data rows found in CSV." },
        { status: 422 }
      );
    }
    const scan = { ...summarizeRowsForUploadUi(rows), csvKind };
    return NextResponse.json({ ok: true, data: { scan } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
