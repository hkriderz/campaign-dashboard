import {
  buildBaselineComparison,
} from "../lib/canvassing/non-contact-patterns/baseline";
import {
  loadPercentileWindowMetrics,
  loadTrailingWindowMetrics,
} from "../lib/canvassing/non-contact-patterns/historical";
import {
  getNonContactPatternReport,
  listNonContactPatternReports,
} from "../lib/canvassing/non-contact-patterns/store";

async function main(): Promise<void> {
  const items = listNonContactPatternReports();
  console.log(`saved reports: ${items.length}`);
  const jul21 = items.find((r) => r.reportDate === "2026-07-21");
  if (!jul21) throw new Error("Missing 2026-07-21 report");

  const report = getNonContactPatternReport(jul21.id);
  if (!report) throw new Error("Could not load 2026-07-21 report");

  const history = loadTrailingWindowMetrics({ days: 7, asOfDate: "2026-07-22" });
  const percentileHistory = loadPercentileWindowMetrics({ days: 14, asOfDate: "2026-07-22" });
  const comparison = buildBaselineComparison({
    result: report,
    history,
    percentileHistory,
    asOfDate: "2026-07-22",
  });

  console.log(
    `baseline days=${comparison.baseline.daysInWindow} sufficient=${comparison.baseline.sufficientHistory}`
  );
  console.log(`medianRapidRate=${comparison.baseline.medianRapidRate}`);
  console.log(`p95RapidRate=${comparison.baseline.p95RapidRate}`);
  console.log(`p95BucketShare0to15=${comparison.baseline.p95RapidBucketShare0to15}`);

  const frank = comparison.canvasserScores.find((s) => /frankenfeld/i.test(s.canvasserName));
  console.log("Frankenfeld score:", JSON.stringify(frank, null, 2));

  const top = [...comparison.canvasserScores]
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 8);
  console.log("Top composite scores on 2026-07-21:");
  for (const s of top) {
    console.log(`  ${s.canvasserName}: tier=${s.anomalyTier} score=${s.compositeScore}`);
  }

  // Cross-check: Frankenfeld should be high confidence given multi-day elevated flags
  if (!frank || frank.compositeScore < 40) {
    throw new Error("Expected Frankenfeld to rank with elevated composite score");
  }
  if (frank.anomalyTier !== 1 && frank.anomalyTier !== 2) {
    throw new Error(`Expected Frankenfeld tier 1 or 2, got ${frank.anomalyTier}`);
  }
  console.log("Frankenfeld cross-check PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
