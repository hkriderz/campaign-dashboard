import { NextRequest, NextResponse } from "next/server";
import { getTagById } from "@/lib/campaign-tags";
import { buildWideImportPreview } from "@/lib/pb-wide-report-to-sheet-rows";
import { convertStwRawToPbReport, parseRawCsvToMatrix } from "@/lib/stw-raw-to-pb-report";
import { loadWideHeaderFieldMap } from "@/lib/stw-wide-header-field-map-store";
import { loadWideReferenceHeaders } from "@/lib/stw-wide-reference-store";
import {
  applyWideColumnOrderToCsvText,
  computeCanonicalWideColumnOrder,
  computeStwWideColumnOrder,
} from "@/lib/wide-csv-column-order";

/**
 * POST multipart: file (raw STW CSV), timezone?, tag? (for column-reference hints)
 * Returns wide PB report CSV text + column match preview.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const timezone = form.get("timezone")?.toString()?.trim() || "US/Pacific";
    const tagId = form.get("tag")?.toString()?.trim() || "";

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const text = await file.text();
    const { headers: rawStwHeaders } = parseRawCsvToMatrix(text);
    const { wideCsv: wideRaw, columns: discoveredColumns, rowCount, datesIso, dateRowCounts } =
      convertStwRawToPbReport(text, {
        timezone,
      });

    const ref =
      tagId && getTagById(tagId) ? loadWideReferenceHeaders(tagId) ?? undefined : undefined;
    const savedMap =
      tagId && getTagById(tagId) ? loadWideHeaderFieldMap(tagId) ?? undefined : undefined;

    const naturalColumnOrder = computeStwWideColumnOrder(rawStwHeaders, discoveredColumns);
    const wideCsv = applyWideColumnOrderToCsvText(wideRaw, naturalColumnOrder);

    const dashboardColumnOrder = computeCanonicalWideColumnOrder(naturalColumnOrder, {
      referenceHeaders: ref,
      savedHeaderFieldMap: savedMap,
    });

    const matchPreview = buildWideImportPreview(naturalColumnOrder, ref ?? undefined, savedMap);

    return NextResponse.json({
      ok: true,
      data: {
        wideCsv,
        /** Default: raw STW script column order, canvass last. */
        columns: naturalColumnOrder,
        sourceColumnOrder: naturalColumnOrder,
        rowCount,
        datesIso,
        dateRowCounts,
        defaultColumnOrder: dashboardColumnOrder,
        matchPreview: {
          mappedToSheet: matchPreview.mappedToSheet.map(({ header, sheetField, category }) => ({
            header,
            sheetField,
            category,
          })),
          extraColumns: matchPreview.storedAsExtra.map(({ header, matched, category }) => ({
            header,
            matched,
            category,
          })),
          extraColumnOrder: matchPreview.extraWideColumnOrder,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
