import { NextRequest, NextResponse } from "next/server";
import { detectPbCsvUploadKind, parsePhoneBankCsvForUpload } from "@/lib/csv-upload-parse";
import { getSliceKeysForRows, mergeCsvDataBySlice } from "@/lib/csv-store";
import { getTagById } from "@/lib/campaign-tags";

/**
 * POST /api/phonebanking/upload
 * Accepts multipart form data with fields:
 *   tag  — campaign tag ID (e.g. "faizah")
 *   file — the Google Sheets CSV export
 *
 * Parses the CSV, normalizes names, and saves to /data/phonebanking-csv-{tag}.json
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const tagId = formData.get("tag")?.toString();
    const file = formData.get("file");

    if (!tagId || !file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: tag, file", code: 400 },
        { status: 400 }
      );
    }

    const tag = getTagById(tagId);
    if (!tag) {
      return NextResponse.json(
        { ok: false, error: `Unknown tag: ${tagId}`, code: 404 },
        { status: 404 }
      );
    }

    const csvText = await file.text();
    const phoneBankNameForWide = formData.get("phoneBankName")?.toString()?.trim() ?? "";
    const csvKind = detectPbCsvUploadKind(csvText);
    if (csvKind === "wide_pb_crosstab" && !phoneBankNameForWide) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This CSV is a wide crosstab (Caller Name, Date, …). Add form field phoneBankName or use the CSV upload hub and enter a phone bank name.",
          code: 400,
        },
        { status: 400 }
      );
    }
    const rows = parsePhoneBankCsvForUpload(csvText, {
      widePhoneBankName: phoneBankNameForWide || undefined,
    });

    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "No data rows found in CSV. Check the file format.", code: 422 },
        { status: 422 }
      );
    }

    const mergeResult = mergeCsvDataBySlice(tagId, rows);
    const uploadedSliceCount = getSliceKeysForRows(rows).size;

    return NextResponse.json({
      ok: true,
      data: {
        tag: tagId,
        uploadedRowCount: rows.length,
        uploadedSliceCount,
        rowCount: mergeResult.rowCount,
        sliceCount: mergeResult.sliceCount,
        replacedSliceCount: mergeResult.replacedSliceCount,
        insertedSliceCount: mergeResult.insertedSliceCount,
        phoneBanks: [...new Set(rows.map((r) => r.phoneBankName).filter(Boolean))],
        callers: [...new Set(rows.map((r) => r.callerName))].sort(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/phonebanking/upload] Error:", message);
    return NextResponse.json(
      { ok: false, error: message, code: 500 },
      { status: 500 }
    );
  }
}
