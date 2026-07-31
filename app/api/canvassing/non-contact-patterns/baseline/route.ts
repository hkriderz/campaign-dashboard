import { NextResponse } from "next/server";
import { buildBaselineComparison, emptyBaselineBanner } from "@/lib/canvassing/non-contact-patterns/baseline";
import {
  latestSavedReportDate,
  loadPercentileWindowMetrics,
  loadTrailingWindowMetrics,
} from "@/lib/canvassing/non-contact-patterns/historical";
import { getNonContactPatternReport } from "@/lib/canvassing/non-contact-patterns/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days") ?? "21") || 21));
    const reportId = url.searchParams.get("reportId");
    const report = reportId ? getNonContactPatternReport(reportId) : null;

    if (reportId && !report) {
      return NextResponse.json({ ok: false, error: "Report not found.", code: 404 }, { status: 404 });
    }

    const asOfDate =
      url.searchParams.get("asOf") ||
      report?.reportDate ||
      latestSavedReportDate() ||
      new Date().toISOString().slice(0, 10);

    const history = loadTrailingWindowMetrics({ days, asOfDate });
    const percentileHistory = loadPercentileWindowMetrics({ days: Math.max(days, 14), asOfDate });

    if (!report) {
      const { computeTeamBaseline } = await import("@/lib/canvassing/non-contact-patterns/baseline");
      const baseline = computeTeamBaseline(history);
      return NextResponse.json({
        ok: true,
        data: {
          baseline,
          historyDays: history.length,
          asOf: asOfDate,
          days,
          banner: baseline.sufficientHistory ? null : emptyBaselineBanner(),
          trend: history.map((h) => ({
            reportDate: h.reportDate,
            reportId: h.reportId,
            rapidNonContactFlagCount: h.rapidNonContactFlagCount,
            flaggedCanvasserCount: h.flaggedCanvasserCount,
          })),
        },
      });
    }

    const comparison = buildBaselineComparison({
      result: report,
      history,
      percentileHistory,
      asOfDate,
    });

    return NextResponse.json({
      ok: true,
      data: {
        baseline: comparison.baseline,
        canvasserScores: comparison.canvasserScores,
        nearDuplicateNameWarnings: comparison.nearDuplicateNameWarnings,
        historyDays: history.length,
        asOf: asOfDate,
        days,
        banner: comparison.baseline.sufficientHistory ? null : emptyBaselineBanner(),
        trend: history.map((h) => ({
          reportDate: h.reportDate,
          reportId: h.reportId,
          rapidNonContactFlagCount: h.rapidNonContactFlagCount,
          flaggedCanvasserCount: h.flaggedCanvasserCount,
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/non-contact-patterns/baseline GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
