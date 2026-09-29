import { NextResponse } from "next/server";
import { attachSessionCookie, runWithRequestCredentialContext } from "@/lib/credentials";
import { authorizeSnapshotRefresh } from "@/lib/phonebanking-snapshot-refresh-auth";
import { runPhonebankingBqSnapshotRefresh } from "@/lib/phonebanking-bq-snapshot-refresh";

/**
 * POST JSON body:
 * - Single tag, last three Pacific days: `{ "tagId": "faizah", "clear": false }`
 * - Single tag, full history: `{ "tagId": "faizah", "fullRebuild": true }`
 * - Every phone-banking tag: `{ "refreshAll": true, "fullRebuild": false }`
 * - Unfiltered all-campaigns list: `{ "rebuildAllCampaigns": true }`
 *
 * Header: `x-snapshot-secret: <CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET>`
 *
 * `fullRebuild: true` reloads history since 2025-12-01. Omit it to merge the last three Pacific days.
 * Set `clear: true` to delete existing snapshot files for each affected tag before a full rebuild.
 */
export async function POST(req: Request) {
  if (!authorizeSnapshotRefresh(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    tagId?: string;
    refreshAll?: boolean;
    clear?: boolean;
    fullRebuild?: boolean;
    rebuildAllCampaigns?: boolean;
  } | null;

  const { result, sessionId } = await runWithRequestCredentialContext(req, () =>
    runPhonebankingBqSnapshotRefresh({
      refreshAll: body?.refreshAll === true,
      tagId: typeof body?.tagId === "string" ? body.tagId : "",
      clearFirst: body?.clear === true,
      fullRebuild: body?.fullRebuild === true,
      rebuildAllCampaigns: body?.rebuildAllCampaigns === true,
    })
  );

  if (!result.ok) {
    if ("refreshed" in result && result.refreshed) {
      return attachSessionCookie(
        NextResponse.json(
          {
            ok: false,
            refreshed: result.refreshed,
            errors: result.errors,
            message: result.error,
          },
          { status: result.status }
        ),
        sessionId
      );
    }
    return attachSessionCookie(
      NextResponse.json({ error: result.error }, { status: result.status }),
      sessionId
    );
  }

  if ("refreshAll" in result && result.refreshAll) {
    return attachSessionCookie(
      NextResponse.json({
        ok: true,
        refreshAll: true,
        refreshed: result.refreshed,
        errors: result.errors,
      }),
      sessionId
    );
  }

  if ("tagId" in result) {
    return attachSessionCookie(NextResponse.json({ ok: true, tagId: result.tagId }), sessionId);
  }

  return attachSessionCookie(
    NextResponse.json({ error: "Unexpected refresh result" }, { status: 500 }),
    sessionId
  );
}
