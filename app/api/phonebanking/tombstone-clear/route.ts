import { NextRequest, NextResponse } from "next/server";
import { getTagById } from "@/lib/campaign-tags";
import { clearAllTombstones, removeTombstone } from "@/lib/csv-slice-tombstones";

/**
 * POST JSON { tag, sliceKeys?: string[], clearAll?: boolean }
 * - `clearAll: true` — empty the tag’s entire removal log (all tombstones).
 * - `sliceKeys: [...]` — clear only those keys (omit or [] = no-op unless clearAll).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    tag?: string;
    sliceKeys?: unknown;
    clearAll?: unknown;
  } | null;
  const tagId = body?.tag?.trim() ?? "";
  if (!tagId || !getTagById(tagId)) {
    return NextResponse.json({ ok: false, error: "Unknown or missing tag" }, { status: 400 });
  }

  const clearAll = body?.clearAll === true || body?.clearAll === "true";

  if (clearAll) {
    try {
      const cleared = clearAllTombstones(tagId);
      return NextResponse.json({ ok: true, data: { cleared, clearAll: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  const keysRaw = Array.isArray(body?.sliceKeys) ? body!.sliceKeys! : [];
  const sliceKeys = keysRaw
    .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    .map((x) => x.trim());

  if (sliceKeys.length === 0) {
    return NextResponse.json({ ok: true, data: { cleared: 0 } });
  }

  try {
    for (const sk of sliceKeys) {
      removeTombstone(tagId, sk);
    }
    return NextResponse.json({ ok: true, data: { cleared: sliceKeys.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
