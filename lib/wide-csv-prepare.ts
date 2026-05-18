import { getTagById } from "@/lib/campaign-tags";
import { buildWideImportPreview } from "@/lib/pb-wide-report-to-sheet-rows";
import { loadExtraWideColumnOrder } from "@/lib/stw-extra-wide-column-order-store";
import { loadWideHeaderFieldMap } from "@/lib/stw-wide-header-field-map-store";
import { loadWideReferenceHeaders } from "@/lib/stw-wide-reference-store";
import { detectPbCsvUploadKind } from "@/lib/csv-upload-parse";
import { parseRawCsvToMatrix } from "@/lib/stw-raw-to-pb-report";
import { normalizeDateToIso } from "@/lib/slice-key";
import {
  applyWideColumnOrderToCsvText,
  computeCanonicalWideColumnOrder,
  computeStwWideColumnOrder,
} from "@/lib/wide-csv-column-order";

export type WidePbImportMatchPreview = {
  mappedToSheet: Array<{ header: string; sheetField?: string; category: string }>;
  extraColumns: Array<{ header: string; matched: boolean; category: string }>;
  extraColumnOrder: string[];
};

export type WidePbPrepareResult = {
  wideCsv: string;
  columns: string[];
  sourceColumnOrder: string[];
  defaultColumnOrder: string[];
  rowCount: number;
  datesIso: string[];
  dateRowCounts: Record<string, number>;
  matchPreview: WidePbImportMatchPreview;
};

function summarizeWideCsvDates(csvText: string): {
  datesIso: string[];
  dateRowCounts: Record<string, number>;
  rowCount: number;
} {
  const { headers, rows } = parseRawCsvToMatrix(csvText);
  const iDate = headers.findIndex((h) => h.trim() === "Date");
  const dateRowCounts: Record<string, number> = {};
  let rowCount = 0;
  if (iDate < 0) {
    return { datesIso: [], dateRowCounts, rowCount: rows.length };
  }
  for (const r of rows) {
    const raw = (r[iDate] ?? "").trim();
    if (!raw) continue;
    rowCount++;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : normalizeDateToIso(raw);
    if (!iso) continue;
    dateRowCounts[iso] = (dateRowCounts[iso] ?? 0) + 1;
  }
  const datesIso = Object.keys(dateRowCounts).sort((a, b) => a.localeCompare(b));
  return { datesIso, dateRowCounts, rowCount };
}

/**
 * Prepare an on-disk wide PB crosstab (Caller Name, Date, …) for import UI — same shape as stw-convert output.
 */
export type PrepareWidePbCsvOptions = {
  /** Raw STW export header row (script column order). Omit when the file is already wide. */
  rawStwHeaders?: readonly string[];
};

export function prepareWidePbCsvFromText(
  csvText: string,
  tagId: string,
  opts?: PrepareWidePbCsvOptions
): WidePbPrepareResult {
  const kind = detectPbCsvUploadKind(csvText);
  if (kind !== "wide_pb_crosstab") {
    throw new Error(
      "This CSV is not a wide phone-bank crosstab (expected headers “Caller Name”, “Date”, …). Use the roster layout or the Scale-to-Win raw tab."
    );
  }

  const { headers: fileHeaders } = parseRawCsvToMatrix(csvText);
  const rawHeaders =
    opts?.rawStwHeaders?.length && opts.rawStwHeaders.some((h) => h.trim())
      ? [...opts.rawStwHeaders]
      : fileHeaders;

  const ref = tagId && getTagById(tagId) ? loadWideReferenceHeaders(tagId) ?? undefined : undefined;
  const savedMap = tagId && getTagById(tagId) ? loadWideHeaderFieldMap(tagId) ?? undefined : undefined;

  const naturalColumnOrder = computeStwWideColumnOrder(rawHeaders, fileHeaders);
  const wideCsv = applyWideColumnOrderToCsvText(csvText, naturalColumnOrder);

  const dashboardColumnOrder = computeCanonicalWideColumnOrder(naturalColumnOrder, {
    referenceHeaders: ref,
    savedHeaderFieldMap: savedMap,
  });

  const { datesIso, dateRowCounts, rowCount } = summarizeWideCsvDates(wideCsv);
  const preview = buildWideImportPreview(naturalColumnOrder, ref ?? undefined, savedMap);

  return {
    wideCsv,
    columns: naturalColumnOrder,
    sourceColumnOrder: naturalColumnOrder,
    defaultColumnOrder: dashboardColumnOrder,
    rowCount,
    datesIso,
    dateRowCounts,
    matchPreview: {
      mappedToSheet: preview.mappedToSheet.map(({ header, sheetField, category }) => ({
        header,
        sheetField,
        category,
      })),
      extraColumns: preview.storedAsExtra.map(({ header, matched, category }) => ({
        header,
        matched,
        category,
      })),
      extraColumnOrder: preview.extraWideColumnOrder,
    },
  };
}
