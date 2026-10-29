import { NextResponse } from "next/server";
import { loadKnockIndexRows } from "@/lib/canvassing/knock-index-store";
import {
  buildLitQc,
  filterLitQc,
  litQcProjectsInDateRange,
  type LitQcCanvasserRow,
} from "@/lib/canvassing/lit-qc";
import {
  CredentialsRequiredError,
  credentialsRequiredResponse,
  withCredentialContext,
} from "@/lib/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LitQcPayload = {
  hasLitQuestions: boolean;
  minDate: string;
  maxDate: string;
  projects: string[];
  canvassers: LitQcCanvasserRow[];
};

export const GET = withCredentialContext(async (req) => {
  try {
    const url = new URL(req.url);
    const startDate = url.searchParams.get("startDate")?.trim() ?? "";
    const endDate = url.searchParams.get("endDate")?.trim() ?? "";
    const projects = url.searchParams.getAll("project").map((project) => project.trim()).filter(Boolean);
    const tally = buildLitQc(loadKnockIndexRows());
    const filtered = filterLitQc(tally, { startDate, endDate, projects });
    const data: LitQcPayload = {
      hasLitQuestions: tally.hasLitQuestions,
      minDate: tally.minDate,
      maxDate: tally.maxDate,
      projects: litQcProjectsInDateRange(tally, startDate, endDate),
      canvassers: filtered.canvassers,
    };
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/canvassers/lit GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
});
