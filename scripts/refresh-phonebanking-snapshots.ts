/**
 * Rebuild on-disk BQ snapshots (daily-caller, question-stats, call-survey-fill, phone-banks).
 *
 * Usage:
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/refresh-phonebanking-snapshots.ts
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/refresh-phonebanking-snapshots.ts --tag faizah
 */
import fs from "fs";
import path from "path";
import { getPhonebankingTags } from "../lib/campaign-tags";
import { loadDailyCallerSnapshot } from "../lib/bq-snapshot-store";
import { rebuildTagBqSnapshotsFromBigQuery } from "../lib/queries/phonebanking";
import { ensureServerBootstrapped } from "../lib/server/lazy-bootstrap";

function loadDotEnvFile(fileName: string): void {
  const fp = path.join(process.cwd(), fileName);
  if (!fs.existsSync(fp)) return;
  for (const raw of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] != null) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function summarizeTag(tagId: string): string {
  const snap = loadDailyCallerSnapshot(tagId);
  if (!snap) return `${tagId}: no daily-caller snapshot`;
  let ss = 0;
  let synth = 0;
  let synthRows = 0;
  for (const row of snap.rows) {
    ss += row.strongSupport ?? 0;
    const s = row.strongSupportSynthesized ?? 0;
    synth += s;
    if (s > 0) synthRows += 1;
  }
  return `${tagId}: saved ${snap.savedAt} | ${snap.rows.length} rows | SS ${ss} | synthesized ${synth} (${synthRows} rows)`;
}

async function main(): Promise<void> {
  loadDotEnvFile(".env");
  loadDotEnvFile(".env.local");
  ensureServerBootstrapped();

  const tagFlag = process.argv.indexOf("--tag");
  const only = tagFlag >= 0 ? process.argv[tagFlag + 1]?.trim() : "";
  const tags = getPhonebankingTags().filter((t) => (only ? t.id === only : true));
  if (only && tags.length === 0) {
    throw new Error(`Unknown phonebanking tag: ${only}`);
  }

  const errors: { tagId: string; error: string }[] = [];
  for (const tag of tags) {
    const started = Date.now();
    console.log(`Refreshing ${tag.id} (${tag.label})...`);
    try {
      await rebuildTagBqSnapshotsFromBigQuery(tag.id);
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  done in ${elapsed}s — ${summarizeTag(tag.id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ tagId: tag.id, error: message });
      console.error(`  failed: ${message}`);
    }
  }

  if (errors.length > 0) {
    console.error(`Finished with ${errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("All requested tags refreshed.");
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
