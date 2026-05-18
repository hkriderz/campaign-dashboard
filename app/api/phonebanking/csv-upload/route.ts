import { NextRequest, NextResponse } from "next/server";
import { getTagById } from "@/lib/campaign-tags";
import { detectPbCsvUploadKind, parsePhoneBankCsvForUpload } from "@/lib/csv-upload-parse";
import {
  CsvMergeTombstoneError,
  filterIncomingRowsByIncludedIsoDates,
  getCsvUploadedAt,
  getRowsForSlice,
  listCsvSlices,
  mergeCsvUpload,
  removeSliceRows,
  summarizeRowsForUploadUi,
  type CsvFocus,
} from "@/lib/csv-store";
import { addTombstone, listTombstoneEntries } from "@/lib/csv-slice-tombstones";
import { normalizeDateToIso } from "@/lib/slice-key";

function parseFocus(v: string | null): CsvFocus {
  if (v === "gotv" || v === "violation") return v;
  return "general";
}

/**
 * GET ?tag=… — saved slices + tombstones (+ optional ?sliceKey=… preview rows for replace UI)
 * DELETE JSON { tag, sliceKey } — remove one slice + tombstone
 * DELETE JSON { tag, sliceKeys: string[] } — remove many slices
 * DELETE JSON { tag, deleteAll: true } — remove every slice for the tag
 * POST multipart — merge upload (add / replace); fields: tag, file, mode, focus, targetIsoDate?, replaceSliceKey?, acknowledgeTombstone?
 */
export async function GET(req: NextRequest) {
  const tagId = req.nextUrl.searchParams.get("tag")?.trim() ?? "";
  if (!tagId || !getTagById(tagId)) {
    return NextResponse.json({ ok: false, error: "Unknown or missing tag" }, { status: 400 });
  }
  const sliceKey = req.nextUrl.searchParams.get("sliceKey")?.trim() ?? "";
  const slices = listCsvSlices(tagId);
  const tombstones = listTombstoneEntries(tagId);
  const uploadedAt = getCsvUploadedAt(tagId);

  if (sliceKey) {
    const rows = getRowsForSlice(tagId, sliceKey).slice(0, 400);
    return NextResponse.json({
      ok: true,
      data: { tag: tagId, slices, tombstones, uploadedAt, replacePreviewRows: rows },
    });
  }

  return NextResponse.json({
    ok: true,
    data: { tag: tagId, slices, tombstones, uploadedAt },
  });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    tag?: string;
    sliceKey?: string;
    sliceKeys?: unknown;
    deleteAll?: unknown;
  } | null;
  const tagId = body?.tag?.trim() ?? "";
  if (!tagId || !getTagById(tagId)) {
    return NextResponse.json({ ok: false, error: "Unknown or missing tag" }, { status: 400 });
  }

  const deleteAll = body?.deleteAll === true || body?.deleteAll === "true";
  const sliceKeysRaw = Array.isArray(body?.sliceKeys) ? body!.sliceKeys! : [];
  const sliceKeys = sliceKeysRaw
    .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    .map((x) => x.trim());

  if (deleteAll) {
    const keys = listCsvSlices(tagId).map((s) => s.sliceKey);
    let removedRows = 0;
    const removedSliceKeys: string[] = [];
    for (const sk of keys) {
      const before = getRowsForSlice(tagId, sk);
      if (!before.length) continue;
      removedRows += before.length;
      removedSliceKeys.push(sk);
      const head = before[0]!;
      removeSliceRows(tagId, sk);
      addTombstone(tagId, {
        sliceKey: sk,
        reason: "delete",
        phoneBankName: head.phoneBankName,
        isoDate: normalizeDateToIso(head.date) ?? undefined,
      });
    }
    return NextResponse.json({
      ok: true,
      data: { removedRows, removedSlices: removedSliceKeys.length, sliceKeys: removedSliceKeys },
    });
  }

  if (sliceKeys.length > 0) {
    let removedRows = 0;
    const removedSliceKeys: string[] = [];
    for (const sk of sliceKeys) {
      const before = getRowsForSlice(tagId, sk);
      if (!before.length) continue;
      removedRows += before.length;
      removedSliceKeys.push(sk);
      const head = before[0]!;
      removeSliceRows(tagId, sk);
      addTombstone(tagId, {
        sliceKey: sk,
        reason: "delete",
        phoneBankName: head.phoneBankName,
        isoDate: normalizeDateToIso(head.date) ?? undefined,
      });
    }
    if (removedSliceKeys.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No matching slices found for the given keys" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      data: { removedRows, removedSlices: removedSliceKeys.length, sliceKeys: removedSliceKeys },
    });
  }

  const sliceKey = body?.sliceKey?.trim() ?? "";
  if (!sliceKey) {
    return NextResponse.json(
      { ok: false, error: "Provide sliceKey, sliceKeys[], or deleteAll" },
      { status: 400 }
    );
  }
  const before = getRowsForSlice(tagId, sliceKey);
  if (!before.length) {
    return NextResponse.json({ ok: false, error: "Slice not found" }, { status: 404 });
  }
  const head = before[0]!;
  removeSliceRows(tagId, sliceKey);
  addTombstone(tagId, {
    sliceKey,
    reason: "delete",
    phoneBankName: head.phoneBankName,
    isoDate: normalizeDateToIso(head.date) ?? undefined,
  });
  return NextResponse.json({
    ok: true,
    data: { removedRows: before.length, sliceKey },
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const tagId = form.get("tag")?.toString()?.trim() ?? "";
    const file = form.get("file");
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
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const csvText = await file.text();
    const csvKind = detectPbCsvUploadKind(csvText);
    const phoneBankNameForWide = form.get("phoneBankName")?.toString()?.trim() ?? "";
    if (csvKind === "wide_pb_crosstab" && !phoneBankNameForWide) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This CSV is a wide crosstab (Caller Name, Date, …). Enter the dashboard **Phone bank name** in the hub so all caller rows merge under one campaign (like BigQuery), then upload again.",
        },
        { status: 400 }
      );
    }

    let rows = parsePhoneBankCsvForUpload(csvText, {
      widePhoneBankName: phoneBankNameForWide || undefined,
    });
    rows = filterIncomingRowsByIncludedIsoDates(rows, includedIsoDates);
    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "No data rows found in CSV. Check the file format." },
        { status: 422 }
      );
    }

    const scan = summarizeRowsForUploadUi(rows);

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

      return NextResponse.json({
        ok: true,
        data: {
          ...result,
          scan,
        },
      });
    } catch (e) {
      if (e instanceof CsvMergeTombstoneError) {
        return NextResponse.json(
          {
            ok: false,
            code: e.code,
            error: e.message,
            sliceKeys: e.sliceKeys,
            scan,
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
