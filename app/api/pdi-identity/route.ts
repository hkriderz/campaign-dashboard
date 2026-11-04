import { NextResponse } from "next/server";
import {
  clearAllPdiIdentities,
  deletePdiIdentities,
  listPdiIdentities,
  parsePdiIdentityPaste,
  upsertPdiIdentities,
  type PdiIdentityUpsertInput,
} from "@/lib/pdi-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const records = listPdiIdentities();
    return NextResponse.json({
      ok: true,
      data: { records, count: records.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pdi-identity GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      entries?: PdiIdentityUpsertInput[];
      paste?: string;
      replaceEmpty?: boolean;
    };

    let entries: PdiIdentityUpsertInput[] = Array.isArray(body.entries) ? body.entries : [];
    let skippedLines = 0;
    if (typeof body.paste === "string" && body.paste.trim()) {
      const parsed = parsePdiIdentityPaste(body.paste);
      entries = [...entries, ...parsed.entries];
      skippedLines = parsed.skippedLines;
    }

    if (!entries.length) {
      return NextResponse.json(
        { ok: false, error: "Provide entries[] or paste text with at least one PDI id.", code: 400 },
        { status: 400 }
      );
    }

    const replaceEmpty = Boolean(body.replaceEmpty);
    const result = upsertPdiIdentities(
      entries.map((entry) => ({
        ...entry,
        replaceEmpty: entry.replaceEmpty ?? replaceEmpty,
      }))
    );

    return NextResponse.json({
      ok: true,
      data: {
        saved: result.saved,
        savedCount: result.saved.length,
        skippedNoPdiId: result.skippedNoPdiId,
        skippedLines,
        records: listPdiIdentities(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pdi-identity PUT]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as { pdiIds?: string[]; all?: boolean };
    if (body.all) {
      const cleared = clearAllPdiIdentities();
      return NextResponse.json({
        ok: true,
        data: {
          deleted: [] as string[],
          deletedCount: cleared.deletedCount,
          missing: [] as string[],
          records: listPdiIdentities(),
        },
      });
    }
    const pdiIds = Array.isArray(body.pdiIds) ? body.pdiIds : [];
    if (!pdiIds.length) {
      return NextResponse.json(
        { ok: false, error: "Body must include pdiIds: string[] or all: true.", code: 400 },
        { status: 400 }
      );
    }
    const result = deletePdiIdentities(pdiIds);
    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        deletedCount: result.deleted.length,
        records: listPdiIdentities(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pdi-identity DELETE]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}
