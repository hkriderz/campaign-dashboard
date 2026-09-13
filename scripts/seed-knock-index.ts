/**
 * Import Canvasser Details CSVs into data/canvassing-reports/knock-index.json.
 *
 * Default files (campaign exports already on disk):
 *   canvassref/Canvasser Details - (Beginning to 9_6_2026).csv
 *   canvassref/Canvasser Details - (9_7 to_9_12_2026).csv
 *
 * Usage:
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/seed-knock-index.ts
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/seed-knock-index.ts --input path/a.csv --input path/b.csv
 */
import fs from "fs";
import path from "path";
import { appendKnockEventsToIndex } from "../lib/canvassing/knock-index-store";
import { buildKnockEvents, parseCanvassingUploadFile } from "../lib/canvassing/knock-details-parser";

const DEFAULT_FILES = [
  "Canvasser Details - (Beginning to 9_6_2026).csv",
  "Canvasser Details - (9_7 to_9_12_2026).csv",
];

function collectInputs(): string[] {
  const explicit: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--input" && process.argv[i + 1]) {
      explicit.push(process.argv[i + 1]!);
    }
  }
  if (explicit.length) return explicit.map((item) => path.resolve(item));
  return DEFAULT_FILES.map((fileName) => path.join(process.cwd(), "canvassref", fileName));
}

async function main(): Promise<void> {
  const inputs = collectInputs();
  for (const resolved of inputs) {
    if (!fs.existsSync(resolved)) {
      throw new Error(`Input not found: ${resolved}`);
    }
  }

  const parsed = (
    await Promise.all(
      inputs.map((filePath) =>
        parseCanvassingUploadFile({
          fileName: path.basename(filePath),
          relativePath: path.basename(filePath),
          buffer: fs.readFileSync(filePath),
        })
      )
    )
  ).flat();
  const knock = buildKnockEvents(parsed);
  const result = appendKnockEventsToIndex(knock.events, {
    source: "seed",
    fileNames: inputs.map((filePath) => path.basename(filePath)),
  });

  console.log(
    `Knock index: added=${result.importMeta.rowsAdded} dups=${result.importMeta.rowsSkippedDup} noPrimaryId=${result.importMeta.rowsSkippedNoPrimaryId} total=${result.rowCount}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
