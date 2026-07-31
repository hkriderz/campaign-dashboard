import { NextResponse } from "next/server";
import { buildNonContactPatternWorkbook } from "@/lib/canvassing/non-contact-patterns/export";
import { buildBaselineComparison } from "@/lib/canvassing/non-contact-patterns/baseline";
import {
  loadPercentileWindowMetrics,
  loadTrailingWindowMetrics,
} from "@/lib/canvassing/non-contact-patterns/historical";
import { getNonContactPatternReport } from "@/lib/canvassing/non-contact-patterns/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ reportId: string }> };

export async function GET(req: Request, context: RouteContext) {
  try {
    const { reportId } = await context.params;
    const report = getNonContactPatternReport(reportId);
    if (!report) {
      return NextResponse.json({ ok: false, error: "Report not found.", code: 404 }, { status: 404 });
    }

    const url = new URL(req.url);
    const includeBaseline = url.searchParams.get("baseline") !== "0";
    let comparison = null;
    if (includeBaseline) {
      const asOf = report.reportDate || undefined;
      const history = loadTrailingWindowMetrics({ days: 21, asOfDate: asOf });
      const percentileHistory = loadPercentileWindowMetrics({ days: 21, asOfDate: asOf });
      comparison = buildBaselineComparison({
        result: report,
        history,
        percentileHistory,
        asOfDate: asOf,
      });
    }

    const buffer = await buildNonContactPatternWorkbook(report, comparison);
    const fileName = `non-contact-patterns-${report.reportDate || report.id}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/non-contact-patterns/export GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
