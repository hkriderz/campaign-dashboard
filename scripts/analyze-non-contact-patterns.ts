/**
 * CLI for non-contact pattern detection.
 *
 * Usage:
 *   npx tsx scripts/analyze-non-contact-patterns.ts \
 *     --input "canvassref/Canvasser Details - (7_22_2026).csv" \
 *     --output "./output/non-contact-analysis.xlsx" \
 *     --non-contact-seconds 15 \
 *     --contact-seconds 30
 */
import fs from "fs";
import path from "path";
import { analyzeNonContactPatternFile } from "../lib/canvassing/non-contact-patterns/analyzer";
import { buildNonContactPatternWorkbook } from "../lib/canvassing/non-contact-patterns/export";

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function getNumberArg(flag: string, fallback: number): number {
  const raw = getArg(flag);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<void> {
  const inputPath = getArg("--input");
  if (!inputPath) {
    console.error("Required: --input <path-to-csv-or-xlsx>");
    process.exit(1);
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Input not found: ${resolved}`);
    process.exit(1);
  }

  const outputPath = path.resolve(
    getArg("--output") ?? "./output/non-contact-analysis.xlsx"
  );
  const settings = {
    rapidNonContactMaxSeconds: getNumberArg("--non-contact-seconds", 15),
    rapidContactMaxSeconds: getNumberArg("--contact-seconds", 30),
    streakAlertMin: getNumberArg("--streak-alert", 4),
  };

  const buffer = fs.readFileSync(resolved);
  const ingestion = await analyzeNonContactPatternFile(
    { fileName: path.basename(resolved), buffer },
    settings
  );

  console.log(
    `Dates in file: ${ingestion.distinctDates.join(", ") || "(none)"}` +
      (ingestion.splitByDate ? ` (split into ${ingestion.results.length} day reports)` : "")
  );

  for (const result of ingestion.results) {
    const date = result.summary.detectedReportDate ?? "unknown";
    console.log(`\n=== ${date} ===`);
    console.log(
      `resolution=${result.summary.timestampResolution} rows=${result.summary.totalRows} canvassers=${result.summary.totalCanvassers}`
    );
    console.log(
      `rapidNonContact=${result.summary.rapidNonContactFlagCount} rapidContact=${result.summary.rapidContactFlagCount} streakAlerts=${result.summary.streakAlertCanvasserCount}`
    );
    if (result.summary.resolutionWarning) {
      console.warn(`WARNING: ${result.summary.resolutionWarning}`);
    }

    const top = result.canvasserSummaries
      .filter((s) => s.rapidNonContactCount > 0)
      .slice(0, 10);
    console.log("Top canvassers by rapid non-contact flags:");
    for (const s of top) {
      console.log(
        `  ${s.canvasserName}: flags=${s.rapidNonContactCount} streak=${s.longestRapidNonContactStreak}` +
          (s.rateSampleInsufficient
            ? " (insufficient sample for rate)"
            : s.rapidNonContactRate !== null
              ? ` rate=${(s.rapidNonContactRate * 100).toFixed(1)}%`
              : "")
      );
    }

    const dayOutput =
      ingestion.results.length > 1
        ? outputPath.replace(/\.xlsx$/i, `-${date}.xlsx`)
        : outputPath;
    fs.mkdirSync(path.dirname(dayOutput), { recursive: true });
    const xlsx = await buildNonContactPatternWorkbook(result);
    fs.writeFileSync(dayOutput, xlsx);
    console.log(`Wrote ${dayOutput}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
