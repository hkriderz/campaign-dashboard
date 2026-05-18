import { NextResponse } from "next/server";
import {
  CAMPAIGN_TAGS_FILE_VERSION,
  getCampaignTagsConfigPath,
  validateStoredTags,
  writeCampaignTagsConfigToDisk,
} from "@/lib/campaign-tags-file";
import {
  getActivePhonebankingTagRows,
  getCampaignTagsConfigForEditor,
  reloadCampaignTagsFromDisk,
} from "@/lib/campaign-tags";

function requireSnapshotSecret(req: Request): boolean {
  const secret = process.env.CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET;
  return Boolean(secret && req.headers.get("x-snapshot-secret") === secret);
}

/**
 * GET — current editor payload + resolved phone-banking tags (including QC slugs).
 * POST — replace `campaign-tags.json`, reload in-memory tags, optionally refresh all BQ snapshots.
 * POST header: `x-snapshot-secret: <CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET>`
 */
export async function GET() {
  const editor = getCampaignTagsConfigForEditor();
  const activePhonebankingTags = getActivePhonebankingTagRows();

  return NextResponse.json({
    configPath: getCampaignTagsConfigPath(),
    source: editor.source,
    version: CAMPAIGN_TAGS_FILE_VERSION,
    tags: editor.tags,
    activePhonebankingTags,
  });
}

export async function POST(req: Request) {
  if (!requireSnapshotSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    tags?: unknown;
    refreshBigQuery?: boolean;
    clearSnapshots?: boolean;
  } | null;

  const validated = validateStoredTags(body?.tags);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  writeCampaignTagsConfigToDisk({
    version: CAMPAIGN_TAGS_FILE_VERSION,
    tags: validated.tags,
  });
  reloadCampaignTagsFromDisk();

  let snapshotRefresh:
    | Awaited<
        ReturnType<
          typeof import("@/lib/phonebanking-bq-snapshot-refresh")["runPhonebankingBqSnapshotRefresh"]
        >
      >
    | undefined;

  if (body?.refreshBigQuery === true) {
    const { runPhonebankingBqSnapshotRefresh } = await import(
      "@/lib/phonebanking-bq-snapshot-refresh"
    );
    snapshotRefresh = await runPhonebankingBqSnapshotRefresh({
      refreshAll: true,
      clearFirst: body.clearSnapshots === true,
    });
  }

  const activePhonebankingTags = getActivePhonebankingTagRows();

  return NextResponse.json({
    ok: true,
    configPath: getCampaignTagsConfigPath(),
    source: "file" as const,
    tags: validated.tags,
    activePhonebankingTags,
    snapshotRefresh: snapshotRefresh ?? null,
  });
}
