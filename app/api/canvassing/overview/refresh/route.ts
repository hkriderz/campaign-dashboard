import { NextResponse } from "next/server";
import { CredentialsRequiredError, credentialsRequiredResponse, withCredentialContext } from "@/lib/credentials";
import { runUniqueIdSnapshotRefresh } from "@/lib/unique-ids/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withCredentialContext(async (req) => {
  try {
    const body = (await req.json().catch(() => null)) as {
      tagId?: string;
      refreshAll?: boolean;
    } | null;

    const result = await runUniqueIdSnapshotRefresh({
      refreshAll: body?.refreshAll === true,
      tagId: typeof body?.tagId === "string" ? body.tagId : "",
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          code: result.status,
          refreshed: result.refreshed,
          errors: result.errors,
        },
        { status: result.status }
      );
    }

    if ("refreshAll" in result && result.refreshAll) {
      return NextResponse.json({
        ok: true,
        refreshAll: true,
        refreshed: result.refreshed,
        errors: result.errors,
      });
    }

    if ("tagId" in result) {
      return NextResponse.json({ ok: true, tagId: result.tagId });
    }

    return NextResponse.json({ ok: false, error: "Unexpected refresh result.", code: 500 }, { status: 500 });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/overview/refresh]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}, { gcp: true });
