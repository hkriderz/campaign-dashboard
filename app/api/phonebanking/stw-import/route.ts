import { NextRequest, NextResponse } from "next/server";
import { getTagById } from "@/lib/campaign-tags";
import {
  CsvMergeTombstoneError,
  filterIncomingRowsByIncludedIsoDates,
  mergeCsvUpload,
  type CsvFocus,
} from "@/lib/csv-store";
import {
  buildWideImportPreview,
  widePbReportCsvToPhoneBankRows,
} from "@/lib/pb-wide-report-to-sheet-rows";
import { mergeExtraWideColumnOrder } from "@/lib/stw-extra-wide-column-order-store";
import {
  loadWideHeaderFieldMap,
  mergeWideHeaderFieldMap,
} from "@/lib/stw-wide-header-field-map-store";
import { parseRawCsvToMatrix } from "@/lib/stw-raw-to-pb-report";
import { saveWideReferenceHeaders } from "@/lib/stw-wide-reference-store";
import type { PhoneBankCsvRow } from "@/lib/types";
import { applyWideColumnOrderToCsvText, parseWideColumnOrderJson } from "@/lib/wide-csv-column-order";

function parseFocus(v: string | null): CsvFocus {
  if (v === "gotv" || v === "violation") return v;
  return "general";
}

/**
 * POST multipart: tag, wideCsv (text) OR file (wide PB report), phoneBankName,
 * mode (add|replace), replaceSliceKey?, targetIsoDate?, focus?, acknowledgeTombstone?,
 * includedIsoDates? (JSON array of YYYY-MM-DD — omit for all rows)
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const tagId = form.get("tag")?.toString()?.trim() ?? "";
    const phoneBankName = form.get("phoneBankName")?.toString()?.trim() ?? "";
    const wideCsvField = form.get("wideCsv")?.toString();
    const wideFile = form.get("file");
    const modeRaw = form.get("mode")?.toString()?.trim() ?? "add";
    const mode = modeRaw === "replace" ? "replace" : "add";
    const focus = parseFocus(form.get("focus")?.toString() ?? null);
    const targetIsoDate = form.get("targetIsoDate")?.toString()?.trim() || null;
    const replaceSliceKey = form.get("replaceSliceKey")?.toString()?.trim() || null;
    const acknowledgeTombstone =
      form.get("acknowledgeTombstone")?.toString() === "1" ||
      form.get("acknowledgeTombstone")?.toString() === "true";

    const includedRaw = form.get("includedIsoDates")?.toString()?.trim() ?? "";
    let includedIsoDates: string[] | undefined;
    if (includedRaw) {
      try {
        const parsed = JSON.parse(includedRaw) as unknown;
        if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
          return NextResponse.json(
            { ok: false, error: "includedIsoDates must be a JSON array of ISO date strings (YYYY-MM-DD)." },
            { status: 400 }
          );
        }
        includedIsoDates = parsed;
      } catch {
        return NextResponse.json(
          { ok: false, error: "includedIsoDates must be valid JSON." },
          { status: 400 }
        );
      }
    }

    if (!tagId || !getTagById(tagId)) {
      return NextResponse.json({ ok: false, error: "Unknown or missing tag" }, { status: 400 });
    }
    if (!phoneBankName) {
      return NextResponse.json({ ok: false, error: "phoneBankName is required" }, { status: 400 });
    }

    let wideCsv = typeof wideCsvField === "string" ? wideCsvField : "";
    if (!wideCsv && wideFile instanceof File) {
      wideCsv = await wideFile.text();
    }
    if (!wideCsv.trim()) {
      return NextResponse.json(
        { ok: false, error: "Provide wideCsv text or a wide PB report file" },
        { status: 400 }
      );
    }

    const parsedOrder = parseWideColumnOrderJson(form.get("wideColumnOrder")?.toString() ?? null);
    if (parsedOrder?.length) {
      wideCsv = applyWideColumnOrderToCsvText(wideCsv, parsedOrder);
    }

    const savedMap = loadWideHeaderFieldMap(tagId);
    const { rows: parsedRows, extraWideColumnOrder } = widePbReportCsvToPhoneBankRows(wideCsv, phoneBankName, {
      savedHeaderFieldMap: savedMap,
    });
    if (parsedRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No caller rows found in the wide PB report." },
        { status: 400 }
      );
    }
    const rows = filterIncomingRowsByIncludedIsoDates(parsedRows, includedIsoDates);
    if (rows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No rows match the selected calendar days (or none left after filtering). Widen your date selection or fix the file Date column.",
        },
        { status: 400 }
      );
    }

    try {
      const result = mergeCsvUpload({
        tag: tagId,
        incomingRows: rows,
        mode,
        replaceSliceKey: mode === "replace" ? replaceSliceKey : null,
        targetIsoDate: mode === "add" ? targetIsoDate : null,
        focus: mode === "add" ? focus : "general",
        acknowledgeTombstone,
      });

      const { headers } = parseRawCsvToMatrix(wideCsv);
      saveWideReferenceHeaders(tagId, headers);

      const preview = buildWideImportPreview(headers, undefined, savedMap);
      const fieldMerge: Record<string, keyof PhoneBankCsvRow> = {};
      for (const it of preview.mappedToSheet) {
        if (it.sheetField) fieldMerge[it.header] = it.sheetField;
      }
      mergeWideHeaderFieldMap(tagId, fieldMerge);
      mergeExtraWideColumnOrder(tagId, extraWideColumnOrder);

      return NextResponse.json({ ok: true, data: { ...result, importedRows: rows.length } });
    } catch (e) {
      if (e instanceof CsvMergeTombstoneError) {
        return NextResponse.json(
          {
            ok: false,
            code: e.code,
            error: e.message,
            sliceKeys: e.sliceKeys,
          },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
