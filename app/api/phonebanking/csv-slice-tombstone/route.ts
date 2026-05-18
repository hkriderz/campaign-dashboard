import { NextRequest, NextResponse } from "next/server";
import { getTagById } from "@/lib/campaign-tags";
import { addTombstone } from "@/lib/csv-slice-tombstones";
import { makeSliceKey } from "@/lib/slice-key";

/**
 * POST JSON { tag, sliceKey, campaignName, isoDate }
 * Adds a tombstone for a BQ-only slice (no CSV rows) so merges treat it like a deleted slice.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    tag?: string;
    sliceKey?: string;
    campaignName?: string;
    isoDate?: string;
  } | null;

  const tagId = body?.tag?.trim() ?? "";
  const sliceKey = body?.sliceKey?.trim() ?? "";
  const campaignName = body?.campaignName?.trim() ?? "";
  const isoDate = body?.isoDate?.trim() ?? "";

  if (!tagId || !getTagById(tagId)) {
    return NextResponse.json({ ok: false, error: "Unknown or missing tag" }, { status: 400 });
  }
  if (!sliceKey || !campaignName || !isoDate) {
    return NextResponse.json(
      { ok: false, error: "Missing sliceKey, campaignName, or isoDate" },
      { status: 400 }
    );
  }
  if (makeSliceKey(campaignName, isoDate) !== sliceKey) {
    return NextResponse.json(
      { ok: false, error: "sliceKey does not match campaignName + isoDate" },
      { status: 400 }
    );
  }

  try {
    addTombstone(tagId, {
      sliceKey,
      reason: "delete",
      phoneBankName: campaignName,
      isoDate,
    });
    return NextResponse.json({ ok: true, data: { sliceKey } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
