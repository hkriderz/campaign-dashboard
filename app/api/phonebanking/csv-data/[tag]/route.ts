import { NextRequest, NextResponse } from "next/server";
import { getTagById } from "@/lib/campaign-tags";
import { loadCsvData, hasCsvData, getCsvUploadedAt } from "@/lib/csv-store";

/**
 * GET /api/phonebanking/csv-data/[tag]
 * Returns the parsed CSV rows for a tag, or 404 if no file uploaded yet.
 * Used by client components that need CSV data after initial render.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tag: string }> }
) {
  const { tag: tagId } = await params;
  const tag = getTagById(tagId);

  if (!tag) {
    return NextResponse.json(
      { ok: false, error: `Unknown tag: ${tagId}`, code: 404 },
      { status: 404 }
    );
  }

  if (!hasCsvData(tagId)) {
    return NextResponse.json(
      { ok: false, error: "No CSV data uploaded yet for this tag.", code: 404 },
      { status: 404 }
    );
  }

  try {
    const rows = loadCsvData(tagId);
    const uploadedAt = getCsvUploadedAt(tagId);
    return NextResponse.json({ ok: true, data: { rows, uploadedAt } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, code: 500 },
      { status: 500 }
    );
  }
}
