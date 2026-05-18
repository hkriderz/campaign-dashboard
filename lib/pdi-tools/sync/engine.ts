import { runQuery } from "@/lib/bigquery";
import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";
import { applyPdiToolsEnv } from "./apply-env";
import { ensurePdiSyncTables } from "./bq-sync-bootstrap";
import { DEFAULT_MIN_RECORDS } from "./constants";
import { fillFinalResults, logFinalResultCoverage } from "./fill-final";
import { insertFlagInstances } from "./flag-instances";
import { appendLedgerEntries, loadLedger } from "./ledger";
import { seedLedgerFromExports } from "./ledger-seed";
import { SyncLogger } from "./logger";
import { loadMappingForSync } from "./mapping";
import { postFlagsToPdi } from "./pdi-client";
import { progressForPhase } from "./phases";
import { buildSurveyQuery } from "./query";
import { rollbackSyncRun } from "./rollback";
import { appendSyncRunEvent, finishSyncRun } from "./run-registry";
import { appendSyncRunLog } from "./sync-run-log";
import { loadSyncState, saveSyncState, type SyncState } from "./sync-state";
import { acquireSyncLock, releaseSyncLock } from "./sync-lock";
import { buildMappingReport, writeSyncCsvReports } from "./sync-reports";
import type { SurveyResultRow, SyncRunOptions, SyncRunSummary } from "./types";

function parseRangeOptions(
  options: SyncRunOptions,
  syncState: SyncState,
  log: SyncLogger
): { start: Date; end: Date; startStr: string; endStr: string } {
  if (options.mode === "incremental") {
    const start = new Date(syncState.last_sync_timestamp);
    const end = new Date();
    log.info("Mode: INCREMENTAL (since last sync)");
    return {
      start,
      end,
      startStr: formatQueryDateTime(start),
      endStr: formatQueryDateTime(end),
    };
  }

  if (!options.start?.trim()) {
    throw new Error("For range mode, start date (YYYY-MM-DD) is required.");
  }

  const start = new Date(`${options.start.trim()}T00:00:00`);
  const end = options.end?.trim()
    ? new Date(`${options.end.trim()}T23:59:59`)
    : new Date();
  log.info("Mode: RANGE");
  return {
    start,
    end,
    startStr: formatQueryDateTime(start),
    endStr: formatQueryDateTime(end),
  };
}

function formatQueryDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function runPdiSyncEngine(runId: string, options: SyncRunOptions): Promise<void> {
  const log = new SyncLogger((event) => appendSyncRunEvent(runId, event));
  const runStartedAt = new Date();
  let lockHeld = false;

  try {
    applyPdiToolsEnv();
    const creds = resolvePdiToolsCredentials();
    if (!creds.gcpCredentialsPath) {
      throw new Error("GCP credentials not configured for BigQuery.");
    }

    await ensurePdiSyncTables(log);

    if (options.rollbackRun?.trim()) {
      log.step("starting", progressForPhase("starting"), "=".repeat(70));
      log.step("starting", progressForPhase("starting"), "PDI SURVEY RESULTS SYNC — Rollback (TypeScript engine)");
      log.step("starting", progressForPhase("starting"), "=".repeat(70));
      await rollbackSyncRun(options.rollbackRun.trim(), log);
      finishSyncRun(runId, {
        status: "completed",
        summary: rollbackSummary(runId, options),
      });
      return;
    }

    log.step("starting", progressForPhase("starting"), "=".repeat(70));
    log.step("starting", progressForPhase("starting"), "PDI SURVEY RESULTS SYNC - Started (TypeScript engine)");
    log.step("starting", progressForPhase("starting"), "=".repeat(70));

    const maps = loadMappingForSync(options.mappingFileId);
    log.step(
      "mapping",
      progressForPhase("mapping"),
      `Loading mapping file: ${maps.mappingFilePath.split(/[/\\]/).pop()}`
    );

    const syncState = await loadSyncState(log);
    const { start, end, startStr, endStr } = parseRangeOptions(options, syncState, log);
    log.step("sync_state", progressForPhase("sync_state"), `Date range: ${startStr} to ${endStr}`);
    log.step("sync_state", progressForPhase("sync_state"), `Dry-run: ${options.dryRun}`);

    const query = buildSurveyQuery(startStr, endStr);
    log.step("bigquery", progressForPhase("bigquery"), "Executing BigQuery...");
    const rows = await runQuery<SurveyResultRow>(query);
    log.step("bigquery", progressForPhase("bigquery"), `Retrieved ${rows.length} rows from BigQuery`);

    logFinalResultCoverage(rows, maps, log, "before fill");
    const { rows: filledRows, synthetic } = fillFinalResults(rows, maps, log);
    log.step("fill", progressForPhase("fill"), `After Final Result fill: ${filledRows.length} rows total`);
    logFinalResultCoverage(filledRows, maps, log, "after fill");

    if (filledRows.length === 0) {
      log.warn("No rows returned from BigQuery");
      const summary: SyncRunSummary = emptySummary(runId, options, maps.mappingFilePath, startStr, endStr);
      finishSyncRun(runId, { status: "completed", summary });
      return;
    }

    const acquired = await acquireSyncLock(log);
    if (!acquired) {
      throw new Error("Another sync is already in progress (BQ advisory lock). Wait and retry.");
    }
    lockHeld = true;

    const ledger = await loadLedger(log);
    log.step("ledger", progressForPhase("ledger"), `Ledger loaded: ${ledger.size} previously synced flag entries`);

    await seedLedgerFromExports(ledger, runId, log);

    const { report, payload, rowsSkipped, rowsDeduped, rowsDedupedSameBatch } = buildMappingReport(
      filledRows,
      maps,
      ledger
    );
    log.step(
      "transform",
      progressForPhase("transform"),
      `Transformed ${payload.length} rows to PDI payload (skipped ${rowsSkipped} unmapped, ${rowsDeduped} duplicates incl. ${rowsDedupedSameBatch} duplicate rows in same batch)`
    );

    if (payload.length > 0) {
      log.info(`Sample payload: ${JSON.stringify(payload[0])}`);
    }

    writeSyncCsvReports(
      {
        runId,
        report,
        payload,
        syntheticRows: synthetic,
        syncWindowStart: startStr,
        syncWindowEnd: endStr,
      },
      log
    );

    if (options.dryRun) {
      log.step("complete", progressForPhase("complete"), "DRY-RUN MODE: Skipping PDI post");
      log.step("complete", 100, "=".repeat(70));
      log.step("complete", 100, "PDI SURVEY RESULTS SYNC - Completed (dry-run)");
      log.step("complete", 100, "=".repeat(70));
      const summary: SyncRunSummary = {
        ...emptySummary(runId, options, maps.mappingFilePath, startStr, endStr),
        rowsFromBq: filledRows.length,
        syntheticFinalRows: synthetic.length,
        payloadCount: payload.length,
        rowsSkipped,
        rowsDeduped,
        rowsDedupedSameBatch,
        exitCode: 0,
      };
      finishSyncRun(runId, { status: "completed", summary });
      return;
    }

    if (payload.length === 0) {
      log.warn("No payload to post to PDI");
      log.info("=".repeat(70));
      log.info("PDI SURVEY RESULTS SYNC - Completed (no payload)");
      log.info("=".repeat(70));
      const summary: SyncRunSummary = {
        ...emptySummary(runId, options, maps.mappingFilePath, startStr, endStr),
        rowsFromBq: filledRows.length,
        syntheticFinalRows: synthetic.length,
        payloadCount: 0,
        rowsSkipped,
        rowsDeduped,
        rowsDedupedSameBatch,
        exitCode: 0,
      };
      finishSyncRun(runId, { status: "completed", summary });
      return;
    }

    const minRecords = options.minRecords ?? DEFAULT_MIN_RECORDS;
    log.step("post", progressForPhase("post"), `Posting ${payload.length} records to PDI…`);
    const postResult = await postFlagsToPdi(payload, maps.flagIdToCode, runId, log);

    if (postResult.newLedgerEntries.length > 0) {
      await appendLedgerEntries(postResult.newLedgerEntries, "sync_run", runId, log);
      for (const e of postResult.newLedgerEntries) {
        ledger.add(`${e.pdi_id}|${e.flag_code}|${e.flag_date}`);
      }
    }

    await insertFlagInstances(postResult.newFlagInstances, log);

    log.info("=".repeat(70));
    log.info("SUMMARY");
    log.info("=".repeat(70));
    log.info(`Records successfully posted: ${postResult.successCount}`);
    log.info(`Records failed: ${postResult.failCount}`);
    log.info(`Duplicate records skipped: ${rowsDeduped} (incl. ${rowsDedupedSameBatch} duplicate rows in same batch)`);
    log.info(`Total records in payload: ${payload.length}`);

    const nextState: SyncState = { ...syncState };
    if (postResult.successCount >= minRecords) {
      log.info(
        `✓ Success threshold met (${postResult.successCount} >= ${minRecords}). Updating sync state.`
      );
      nextState.last_sync_timestamp = new Date().toISOString();
      nextState.records_processed = postResult.successCount;
      nextState.date_range = { start: startStr, end: endStr };
      nextState.success_flag = true;
      nextState.error_log = [];
    } else {
      log.warn(
        `✗ Success threshold NOT met (${postResult.successCount} < ${minRecords}). NOT updating sync state.`
      );
      nextState.records_processed = postResult.successCount;
      nextState.success_flag = false;
      nextState.error_log = [
        ...nextState.error_log,
        `Insufficient records posted (${postResult.successCount} < ${minRecords})`,
      ];
    }
    await saveSyncState(nextState, log);

    await appendSyncRunLog(
      {
        runId,
        startedAt: runStartedAt,
        finishedAt: new Date(),
        mode: options.mode,
        dateRangeStart: start,
        dateRangeEnd: end,
        rowsFromBq: filledRows.length,
        rowsDeduped,
        rowsSkipped,
        rowsPosted: postResult.successCount,
        rowsFailed: postResult.failCount,
        successFlag: nextState.success_flag,
        errorSummary: nextState.error_log.join("; "),
      },
      log
    );

    log.step("complete", 100, "=".repeat(70));
    log.step("complete", 100, "PDI SURVEY RESULTS SYNC - Completed");
    log.step("complete", 100, "=".repeat(70));

    const summary: SyncRunSummary = {
      runId,
      engine: "typescript",
      exitCode: postResult.failCount > 0 ? 1 : 0,
      mappingFile: maps.mappingFilePath,
      dateRange: { start: startStr, end: endStr },
      dryRun: false,
      rowsFromBq: filledRows.length,
      syntheticFinalRows: synthetic.length,
      payloadCount: payload.length,
      rowsSkipped,
      rowsDeduped,
      rowsDedupedSameBatch,
      rowsPosted: postResult.successCount,
      rowsFailed: postResult.failCount,
      ledgerSize: ledger.size,
    };
    finishSyncRun(runId, { status: postResult.failCount > 0 ? "failed" : "completed", summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(message);
    finishSyncRun(runId, { status: "failed", error: message });
  } finally {
    if (lockHeld) {
      await releaseSyncLock(log);
    }
  }
}

function rollbackSummary(runId: string, options: SyncRunOptions): SyncRunSummary {
  return {
    runId,
    engine: "typescript",
    exitCode: 0,
    mappingFile: null,
    dateRange: { start: "", end: "" },
    dryRun: options.dryRun,
    rowsFromBq: 0,
    syntheticFinalRows: 0,
    payloadCount: 0,
    rowsSkipped: 0,
    rowsDeduped: 0,
    rowsDedupedSameBatch: 0,
    rowsPosted: 0,
    rowsFailed: 0,
    ledgerSize: 0,
  };
}

function emptySummary(
  runId: string,
  options: SyncRunOptions,
  mappingFile: string | null,
  start: string,
  end: string
): SyncRunSummary {
  return {
    runId,
    engine: "typescript",
    exitCode: 0,
    mappingFile,
    dateRange: { start, end },
    dryRun: options.dryRun,
    rowsFromBq: 0,
    syntheticFinalRows: 0,
    payloadCount: 0,
    rowsSkipped: 0,
    rowsDeduped: 0,
    rowsDedupedSameBatch: 0,
    rowsPosted: 0,
    rowsFailed: 0,
    ledgerSize: 0,
  };
}
