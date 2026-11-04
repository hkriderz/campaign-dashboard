import { NextResponse } from "next/server";
import {
  entriesFromPdiIdentityCsv,
  listPdiIdentities,
  upsertPdiIdentities,
  type PdiIdentityColumnMapping,
} from "@/lib/pdi-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing CSV file.", code: 400 }, { status: 400 });
    }

    const mapping: PdiIdentityColumnMapping = {
      pdiIdCol: String(form.get("pdiIdCol") ?? "").trim(),
      voterNameCol: String(form.get("voterNameCol") ?? "").trim(),
      voterAddressCol: String(form.get("voterAddressCol") ?? "").trim(),
      noteCol: String(form.get("noteCol") ?? "").trim(),
    };

    if (!mapping.pdiIdCol) {
      return NextResponse.json(
        { ok: false, error: "Map a PDI ID column before importing.", code: 400 },
        { status: 400 }
      );
    }

    const text = await file.text();
    const parsed = entriesFromPdiIdentityCsv(text, mapping);
    if (!parsed.entries.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `No usable PDI rows found (${parsed.skippedNoPdiId} skipped without a PDI id).`,
          code: 400,
        },
        { status: 400 }
      );
    }

    const result = upsertPdiIdentities(parsed.entries);
    return NextResponse.json({
      ok: true,
      data: {
        fileName: file.name,
        rowCount: parsed.rowCount,
        savedCount: result.saved.length,
        skippedNoPdiId: parsed.skippedNoPdiId + result.skippedNoPdiId,
        records: listPdiIdentities(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pdi-identity import]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}
