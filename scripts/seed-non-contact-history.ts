/**
 * Seed non-contact pattern history from a multi-day Canvasser Details file.
 * Uses date-aware ingestion (one saved report + metricsSnapshot per date).
 *
 * Usage:
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/seed-non-contact-history.ts \
 *     --input "canvassref/Canvasser Details - (7_9_to_7_22_2026).csv"
 */
import fs from "fs";
import path from "path";
import { analyzeNonContactPatternFile } from "../lib/canvassing/non-contact-patterns/analyzer";
import { saveNonContactPatternReports } from "../lib/canvassing/non-contact-patterns/store";

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const inputPath =
    getArg("--input") ??
    path.join(process.cwd(), "canvassref", "Canvasser Details - (7_9_to_7_22_2026).csv");
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input not found: ${resolved}`);
  }

  console.log(`Seeding from ${resolved}...`);
  const buffer = fs.readFileSync(resolved);
  const ingestion = await analyzeNonContactPatternFile({
    fileName: path.basename(resolved),
    buffer,
  });

  console.log(
    `Detected ${ingestion.distinctDates.length} dates (split=${ingestion.splitByDate}): ${ingestion.distinctDates.join(", ")}`
  );

  const reports = saveNonContactPatternReports({
    namePrefix: "Seeded non-contact patterns",
    results: ingestion.results,
  });

  console.log(`Saved ${reports.length} reports:`);
  for (const report of reports) {
    const frank = report.canvasserSummaries.find((c) => /frankenfeld/i.test(c.canvasserName));
    console.log(
      `  ${report.reportDate}: flags=${report.summary.rapidNonContactFlagCount} canvassers=${report.summary.totalCanvassers}` +
        (frank
          ? ` | Frankenfeld rapidNC=${frank.rapidNonContactCount} streak=${frank.longestRapidNonContactStreak}`
          : "")
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
