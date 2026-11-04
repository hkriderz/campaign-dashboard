import { NextResponse } from "next/server";
import {
  CredentialsRequiredError,
  credentialsRequiredResponse,
  withCredentialContext,
} from "@/lib/credentials";
import { emptyPdiIdentityGapTally } from "@/lib/pdi-identity/gaps";
import { readPdiIdentityMap } from "@/lib/pdi-identity/store";
import { buildUniqueIdOverviewPayload } from "@/lib/unique-ids/payload";
import { parseUniqueIdOverviewQuery } from "@/lib/unique-ids/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCredentialContext(async (req) => {
  try {
    const url = new URL(req.url);
    const query = parseUniqueIdOverviewQuery(url);
    const payload = await buildUniqueIdOverviewPayload({
      ...query,
      page: 1,
      pageSize: 1,
      q: "",
      family: "",
      channel: "",
      format: "json",
    });
    const gaps =
      payload.meta.identityGaps ??
      emptyPdiIdentityGapTally(Object.keys(readPdiIdentityMap()).length);
    return NextResponse.json({
      ok: true,
      data: {
        gaps,
        startDate: query.startDate,
        endDate: query.endDate,
        tagId: query.tagId,
      },
    });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pdi-identity gaps]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
});
