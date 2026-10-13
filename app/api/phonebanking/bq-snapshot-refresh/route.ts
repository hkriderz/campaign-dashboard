import { NextResponse } from "next/server";
import { attachSessionCookie, runWithRequestCredentialContext } from "@/lib/credentials";
import { authorizeSnapshotRefresh } from "@/lib/phonebanking-snapshot-refresh-auth";
import { runPhonebankingBqSnapshotRefresh } from "@/lib/phonebanking-bq-snapshot-refresh";
import { isRefreshProgressId, readRefreshProgress, runWithRefreshProgress } from "@/lib/refresh-progress";

/**
 * POST JSON body:
 * - Single tag, since the last refresh minus one Pacific day: `{ "tagId": "faizah", "clear": false }`
 * - Single tag, full history: `{ "tagId": "faizah", "fullRebuild": true }`
 * - Every phone-banking tag in one request: `{ "refreshAll": true, "fullRebuild": false }`
 * - Refresh all, one tag at a time: `{ "refreshAll": true, "stage": "scan" }`, then `{ "stage": "apply", "batchId", "tagId" }` per tag, then `{ "stage": "discard", "batchId" }`
 * - Unfiltered all-campaigns list: `{ "rebuildAllCampaigns": true }`
 *
 * Header: `x-snapshot-secret: <CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET>`
 *
 * `fullRebuild: true` reloads history since 2025-12-01. Omit it to read rows created since the last query start, minus one Pacific day.
 * Set `clear: true` to delete existing snapshot files for each affected tag before a full rebuild.
 */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : "";
  if (cause && !err.message.includes(cause)) return `${err.message}: ${cause}`;
  return err.message || "Refresh failed";
}

/** Buffered JSON. A streamed body gets dropped when the session cookie is attached. */
function jsonResponse(body: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

type RefreshPostBody = {
  tagId?: string;
  refreshAll?: boolean;
  clear?: boolean;
  fullRebuild?: boolean;
  rebuildAllCampaigns?: boolean;
  stage?: "scan" | "apply" | "discard";
  batchId?: string;
  step?: "dialer" | "text" | "contacts";
  historyStart?: string;
  queryStartedAt?: string;
  incremental?: boolean;
  skipQcSync?: boolean;
  progressId?: string;
};

export async function GET(req: Request) {
  if (!authorizeSnapshotRefresh(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const progressId = new URL(req.url).searchParams.get("progressId") ?? "";
  if (!isRefreshProgressId(progressId)) {
    return jsonResponse({ error: "Unknown progress id" }, 400);
  }
  return jsonResponse(readRefreshProgress(progressId) ?? { label: "Starting", completed: 0, total: 0 });
}

export async function POST(req: Request) {
  try {
    if (!authorizeSnapshotRefresh(req)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: RefreshPostBody | null = null;
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text) as RefreshPostBody;
    } catch (err) {
      return jsonResponse({ error: errorText(err) }, 400);
    }

    const progressId = typeof body?.progressId === "string" ? body.progressId : "";
    const progressTotal = body?.stage === "scan" || body?.stage === "discard" ? 1 : 3;
    const progressLabel = body?.stage === "scan" ? "Scanning dialer tables" : "Dialer rows";

    const { result, sessionId } = await runWithRequestCredentialContext(req, () =>
      runWithRefreshProgress(progressId, progressTotal, progressLabel, () =>
      runPhonebankingBqSnapshotRefresh({
        refreshAll: body?.refreshAll === true,
        tagId: typeof body?.tagId === "string" ? body.tagId : "",
        clearFirst: body?.clear === true,
        fullRebuild: body?.fullRebuild === true,
        rebuildAllCampaigns: body?.rebuildAllCampaigns === true,
        stage: body?.stage,
        batchId: typeof body?.batchId === "string" ? body.batchId : "",
        step: body?.step,
        historyStart: typeof body?.historyStart === "string" ? body.historyStart : "",
        queryStartedAt: typeof body?.queryStartedAt === "string" ? body.queryStartedAt : "",
        incremental: body?.incremental === true,
        skipQcSync: body?.skipQcSync === true,
      })
      )
    );

    if (!result.ok) {
      if ("refreshed" in result && result.refreshed) {
        return attachSessionCookie(
          jsonResponse(
            {
              ok: false,
              refreshed: result.refreshed,
              errors: result.errors,
              message: result.error,
            },
            result.status
          ),
          sessionId
        );
      }
      return attachSessionCookie(
        jsonResponse({ error: result.error || "Refresh failed" }, result.status),
        sessionId
      );
    }

    if (("stage" in result || "step" in result) && result.ok) {
      return attachSessionCookie(jsonResponse(result), sessionId);
    }

    if ("refreshAll" in result && result.refreshAll) {
      return attachSessionCookie(
        jsonResponse({
          ok: true,
          refreshAll: true,
          refreshed: result.refreshed,
          errors: result.errors,
        }),
        sessionId
      );
    }

    if ("tagId" in result) {
      return attachSessionCookie(jsonResponse({ ok: true, tagId: result.tagId }), sessionId);
    }

    return attachSessionCookie(jsonResponse({ error: "Unexpected refresh result" }, 500), sessionId);
  } catch (err) {
    console.error("[bq-snapshot-refresh]", err);
    return jsonResponse({ error: errorText(err) }, 500);
  }
}
