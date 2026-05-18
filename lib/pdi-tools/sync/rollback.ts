import { executeSql, runQuery } from "@/lib/bigquery";
import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";
import { BQ_FLAG_INSTANCES_TABLE, BQ_LEDGER_TABLE } from "./constants";
import { deleteFlagInstance } from "./pdi-client";
import { escapeSqlStringLiteral } from "./sql-escape";
import type { SyncLogger } from "./logger";

type InstanceRow = { instance_id: string; pdi_id?: string; flag_code?: string };

/**
 * Roll back one sync run: DELETE flags in PDI and remove BQ rows keyed by `run_id`
 * (`stw_to_pdi.rollback_run`).
 */
export async function rollbackSyncRun(targetRunId: string, log: SyncLogger): Promise<void> {
  const creds = resolvePdiToolsCredentials();
  if (!creds.pdiUsername || !creds.pdiPassword || !creds.pdiApiToken) {
    throw new Error("PDI credentials missing; cannot delete flags during rollback.");
  }

  const rid = escapeSqlStringLiteral(targetRunId);

  log.info("=".repeat(70));
  log.info(`ROLLBACK: run_id=${targetRunId}`);
  log.info("=".repeat(70));

  let instances: InstanceRow[] = [];
  try {
    instances = await runQuery<InstanceRow>(
      `SELECT instance_id, pdi_id, flag_code FROM \`${BQ_FLAG_INSTANCES_TABLE}\` WHERE run_id = '${rid}'`
    );
  } catch (e) {
    throw new Error(`Could not fetch instance IDs from BigQuery: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (instances.length === 0) {
    log.warn(
      "No instance IDs found for that run_id in created_flag_instances. " +
        "Either the run_id is wrong, the run captured no IDs (PDI didn't return them), " +
        "or the BQ streaming buffer hasn't flushed yet — wait ~2 minutes and retry."
    );
  } else {
    log.info(`Found ${instances.length} flag instances to delete from PDI`);
    let deleted = 0;
    let failed = 0;
    for (const row of instances) {
      const iid = String(row.instance_id ?? "").trim();
      if (!iid) continue;
      try {
        await deleteFlagInstance(iid);
        log.info(`  ✓ Deleted PDI flag instance ${iid} (${row.flag_code} for ${row.pdi_id})`);
        deleted++;
      } catch (e) {
        log.error(`  ✗ Failed to delete ${iid}: ${e instanceof Error ? e.message : String(e)}`);
        failed++;
      }
    }
    log.info(`PDI deletions: ${deleted} succeeded, ${failed} failed`);
  }

  for (const table of [BQ_FLAG_INSTANCES_TABLE, BQ_LEDGER_TABLE]) {
    try {
      await executeSql(`DELETE FROM \`${table}\` WHERE run_id = '${rid}'`);
      log.info(`  ✓ Deleted rows from ${table}`);
    } catch (e) {
      log.warn(`  ✗ Could not delete from ${table}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log.info("=".repeat(70));
  log.info("ROLLBACK complete");
  log.info("=".repeat(70));
}
