import { NextRequest, NextResponse } from "next/server";
import { getTagById } from "@/lib/campaign-tags";
import { getTombstoneBqOverlapForTag } from "@/lib/tombstone-bq-overlap-server";

/** GET ?tag= — tombstoned slice keys that still exist in this tag’s daily-caller snapshot. */
export async function GET(req: NextRequest) {
  const tagId = req.nextUrl.searchParams.get("tag")?.trim() ?? "";
  if (!tagId || !getTagById(tagId)) {
    return NextResponse.json({ ok: false, error: "Unknown or missing tag" }, { status: 400 });
  }
  try {
    const overlaps = getTombstoneBqOverlapForTag(tagId);
    return NextResponse.json({ ok: true, data: { tag: tagId, overlaps } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
