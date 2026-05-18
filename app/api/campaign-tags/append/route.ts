import { NextRequest, NextResponse } from "next/server";
import {
  getCampaignTagsConfigForEditor,
  reloadCampaignTagsFromDisk,
} from "@/lib/campaign-tags";
import {
  CAMPAIGN_TAGS_FILE_VERSION,
  isValidTagId,
  validateStoredTags,
  writeCampaignTagsConfigToDisk,
  type StoredCampaignTagV1,
} from "@/lib/campaign-tags-file";

function canAppend(req: NextRequest): boolean {
  if (process.env.ALLOW_INSECURE_TAG_APPEND === "1") return true;
  const secret = process.env.CAMPAIGN_TAGS_APPEND_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("x-campaign-tags-append-secret") === secret;
}

/**
 * Append one phone-banking (or both) tag to `campaign-tags.json` and reload config.
 * Auth: set `ALLOW_INSECURE_TAG_APPEND=1` for trusted local use, or `CAMPAIGN_TAGS_APPEND_SECRET`
 * and send header `x-campaign-tags-append-secret`.
 */
export async function POST(req: NextRequest) {
  if (!canAppend(req)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Tag append is disabled. Set ALLOW_INSECURE_TAG_APPEND=1 for local-only use, or set CAMPAIGN_TAGS_APPEND_SECRET and send it as header x-campaign-tags-append-secret.",
      },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    id?: unknown;
    label?: unknown;
    searchTerms?: unknown;
    mode?: unknown;
  } | null;

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const modeRaw = body?.mode;
  const mode =
    modeRaw === "both" || modeRaw === "phonebanking" || modeRaw === "canvassing"
      ? modeRaw
      : "phonebanking";

  if (!id || !isValidTagId(id)) {
    return NextResponse.json(
      { ok: false, error: "id must be a non-empty slug (lowercase letters, digits, hyphens)." },
      { status: 400 }
    );
  }
  if (!label) {
    return NextResponse.json({ ok: false, error: "label is required." }, { status: 400 });
  }

  let searchTerms: string[] = [];
  if (Array.isArray(body?.searchTerms)) {
    searchTerms = body.searchTerms.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
  }
  if (searchTerms.length === 0) {
    searchTerms = [label];
  }

  const { tags: existing } = getCampaignTagsConfigForEditor();
  if (existing.some((t) => t.id === id)) {
    return NextResponse.json({ ok: false, error: `Tag id "${id}" already exists.` }, { status: 409 });
  }

  const entry: StoredCampaignTagV1 = {
    id,
    label,
    searchTerms,
    enableQc: false,
    oppositionMode: "none",
    color: "#4f46e5",
    textColor: "#ffffff",
    mode,
  };

  const merged = [...existing, entry];
  const validated = validateStoredTags(merged);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  writeCampaignTagsConfigToDisk({
    version: CAMPAIGN_TAGS_FILE_VERSION,
    tags: validated.tags,
  });
  reloadCampaignTagsFromDisk();

  return NextResponse.json({
    ok: true,
    data: { id: entry.id, label: entry.label },
  });
}
