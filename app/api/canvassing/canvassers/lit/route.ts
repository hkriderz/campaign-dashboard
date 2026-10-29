import { NextResponse } from "next/server";
import { getCachedLitQcTally } from "@/lib/canvassing/lit-qc-cache";
import {
  filterLitQc,
  findLitQcCanvasser,
  litQcProjectsInDateRange,
  litQcSummaryCanvassers,
  type LitQcCanvasserRow,
  type LitQcFilter,
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
  minQcDate: string;
  maxQcDate: string;
  projects: string[];
  canvassers: LitQcCanvasserRow[];
};

function parseLitQcFilter(url: URL): LitQcFilter {
  return {
    startDate: url.searchParams.get("startDate")?.trim() ?? "",
    endDate: url.searchParams.get("endDate")?.trim() ?? "",
    qcStartDate: url.searchParams.get("qcStartDate")?.trim() ?? "",
    qcEndDate: url.searchParams.get("qcEndDate")?.trim() ?? "",
    projects: url.searchParams.getAll("project").map((project) => project.trim()).filter(Boolean),
  };
}

export const GET = withCredentialContext(async (req) => {
  try {
    const url = new URL(req.url);
    const filter = parseLitQcFilter(url);
    const rowId = url.searchParams.get("rowId")?.trim() ?? "";
    const includeDetails = url.searchParams.get("includeDetails") === "1";

    const tally = getCachedLitQcTally();
    const filtered = filterLitQc(tally, filter);

    // Single-canvasser expand: return that row with households only.
    if (rowId) {
      const row = findLitQcCanvasser(filtered.canvassers, rowId);
      if (!row) {
        return NextResponse.json(
          { ok: false, error: "Canvasser not found in this filter.", code: 404 },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, data: { canvasser: row } });
    }

    const canvassers = includeDetails
      ? filtered.canvassers
      : litQcSummaryCanvassers(filtered.canvassers);

    const data: LitQcPayload = {
      hasLitQuestions: tally.hasLitQuestions,
      minDate: tally.minDate,
      maxDate: tally.maxDate,
      minQcDate: tally.minQcDate,
      maxQcDate: tally.maxQcDate,
      projects: litQcProjectsInDateRange(
        tally,
        filter.startDate ?? "",
        filter.endDate ?? "",
        filter.qcStartDate ?? "",
        filter.qcEndDate ?? ""
      ),
      canvassers,
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
