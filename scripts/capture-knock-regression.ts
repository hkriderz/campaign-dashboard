/**
 * Capture Knock Analysis output for regression testing before/after
 * knock-details-parser extraction.
 *
 * Usage:
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/capture-knock-regression.ts
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/capture-knock-regression.ts --compare
 */
import fs from "fs";
import path from "path";
import { analyzeCanvassingUploads } from "../lib/canvassing/engine";

const FIXTURE = path.join(
  process.cwd(),
  "canvassref",
  "Canvasser Details - (7_22_2026).csv"
);
const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "regression",
  "knock-analysis-7_22_2026.snapshot.json"
);

async function main(): Promise<void> {
  const compare = process.argv.includes("--compare");

  if (!fs.existsSync(FIXTURE)) {
    throw new Error(`Fixture not found: ${FIXTURE}`);
  }

  const buffer = fs.readFileSync(FIXTURE);
  const result = await analyzeCanvassingUploads([
    { fileName: path.basename(FIXTURE), relativePath: FIXTURE, buffer },
  ]);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    fixture: path.basename(FIXTURE),
    summary: result.summary,
    canvasserStats: result.canvasserStats,
    gapDetails: result.gapDetails,
    bigGapDetails: result.bigGapDetails,
    hourGapDetails: result.hourGapDetails,
    outlierGapDetails: result.outlierGapDetails,
    validationIssueCount: result.validationIssues.length,
  };

  if (compare) {
    if (!fs.existsSync(SNAPSHOT_PATH)) {
      throw new Error(`No baseline snapshot at ${SNAPSHOT_PATH}. Run without --compare first.`);
    }
    const baseline = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8")) as typeof snapshot;
    const baselineComparable = {
      summary: baseline.summary,
      canvasserStats: baseline.canvasserStats,
      gapDetails: baseline.gapDetails,
      bigGapDetails: baseline.bigGapDetails,
      hourGapDetails: baseline.hourGapDetails ?? [],
      outlierGapDetails: baseline.outlierGapDetails ?? [],
      validationIssueCount: baseline.validationIssueCount,
    };
    const currentComparable = {
      summary: snapshot.summary,
      canvasserStats: snapshot.canvasserStats,
      gapDetails: snapshot.gapDetails,
      bigGapDetails: snapshot.bigGapDetails,
      hourGapDetails: snapshot.hourGapDetails,
      outlierGapDetails: snapshot.outlierGapDetails,
      validationIssueCount: snapshot.validationIssueCount,
    };
    const baselineJson = JSON.stringify(baselineComparable);
    const currentJson = JSON.stringify(currentComparable);
    if (baselineJson !== currentJson) {
      console.error("REGRESSION DIFF: Knock Analysis output changed after refactor.");
      console.error(
        `Baseline canvassers=${baseline.canvasserStats.length} gaps=${baseline.gapDetails.length} bigGaps=${baseline.bigGapDetails.length} hourGaps=${(baseline.hourGapDetails ?? []).length}`
      );
      console.error(
        `Current  canvassers=${snapshot.canvasserStats.length} gaps=${snapshot.gapDetails.length} bigGaps=${snapshot.bigGapDetails.length} hourGaps=${snapshot.hourGapDetails.length}`
      );
      process.exit(1);
    }
    console.log("Regression check PASSED — Knock Analysis output unchanged.");
    console.log(
      `summary: canvassers=${snapshot.summary.totalCanvassers} gapsOver10=${snapshot.summary.gapsOver10} gapsOver60=${snapshot.summary.gapsOver60} outliers=${snapshot.summary.outlierGapsOver120}`
    );
    return;
  }

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`Wrote regression snapshot: ${SNAPSHOT_PATH}`);
  console.log(
    `summary: canvassers=${snapshot.summary.totalCanvassers} validKnocks=${snapshot.summary.validKnockEvents} gapsOver10=${snapshot.summary.gapsOver10} gapsOver60=${snapshot.summary.gapsOver60} outliers=${snapshot.summary.outlierGapsOver120}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
