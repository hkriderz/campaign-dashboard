import { NextResponse } from "next/server";
import { attachSessionCookie, runWithRequestCredentialContext } from "@/lib/credentials";
import { runPhonebankingBqSnapshotRefresh } from "@/lib/phonebanking-bq-snapshot-refresh";

/**
 * POST JSON body:
 * - Single tag: `{ "tagId": "faizah", "clear": false }`
 * - Every phone-banking tag: `{ "refreshAll": true, "clear": false }`
 *
 * Header: `x-snapshot-secret: <CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET>`
 *
 * Re-runs full BigQuery for snapshot-backed datasets and rewrites JSON on disk.
 * Set `clear: true` to delete existing snapshot files for each affected tag before rebuilding.
 */
export async function POST(req: Request) {
  const secret = process.env.CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET;
  if (!secret || req.headers.get("x-snapshot-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    tagId?: string;
    refreshAll?: boolean;
    clear?: boolean;
  } | null;

  const { result, sessionId } = await runWithRequestCredentialContext(req, () =>
    runPhonebankingBqSnapshotRefresh({
      refreshAll: body?.refreshAll === true,
      tagId: typeof body?.tagId === "string" ? body.tagId : "",
      clearFirst: body?.clear === true,
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
