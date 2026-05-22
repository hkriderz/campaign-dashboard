import { runQuery, executeSql } from "@/lib/bigquery";
import * as os from "node:os";
import { BQ_LOCK_TABLE } from "./constants";
import { escapeSqlStringLiteral } from "./sql-escape";
import type { SyncLogger } from "./logger";

const LOCK_TTL_SEC = 1800;

type LockRow = { lock_key?: string; locked_by: string; locked_at: unknown };

export type SyncLockStatus = {
  table: string;
  lockKey: "global";
  locked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  ttlSeconds: number;
};

function coerceTimestamp(val: unknown): string {
  if (val == null) return "";
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "object" && val !== null && "value" in val) {
    return String((val as { value: unknown }).value);
  }
  return String(val);
}

function parseLockedAt(raw: string): Date {
  try {
    const normalized = raw.replace("Z", "+00:00");
    const d = new Date(normalized);
    if (!Number.isFinite(d.getTime())) {
      return new Date(Date.now() - 3_600_000);
    }
    return d;
  } catch {
    return new Date(Date.now() - 3_600_000);
  }
}

function lockHolderIdentity(): string {
  const user = process.env.USER ?? process.env.USERNAME ?? "unknown";
  return `${user}@${os.hostname()}`;
}

export async function getSyncLockStatus(): Promise<SyncLockStatus> {
  const rows = await runQuery<LockRow>(
    `SELECT lock_key, locked_by, locked_at FROM \`${BQ_LOCK_TABLE}\` WHERE lock_key = 'global' LIMIT 1`
  );

  if (rows.length === 0) {
    return {
      table: BQ_LOCK_TABLE,
      lockKey: "global",
      locked: false,
      lockedBy: null,
      lockedAt: null,
      ageSeconds: null,
      stale: false,
      ttlSeconds: LOCK_TTL_SEC,
    };
  }

  const row = rows[0]!;
  const lockedAt = parseLockedAt(coerceTimestamp(row.locked_at));
  const ageSeconds = Math.max(0, Math.floor((Date.now() - lockedAt.getTime()) / 1000));
  return {
    table: BQ_LOCK_TABLE,
    lockKey: "global",
    locked: true,
    lockedBy: row.locked_by,
    lockedAt: lockedAt.toISOString(),
    ageSeconds,
    stale: ageSeconds >= LOCK_TTL_SEC,
    ttlSeconds: LOCK_TTL_SEC,
  };
}

export async function clearGlobalSyncLock(): Promise<void> {
  await executeSql(`DELETE FROM \`${BQ_LOCK_TABLE}\` WHERE lock_key = 'global'`);
}

/**
 * Advisory sync lock in BigQuery (parity with `stw_to_pdi.acquire_sync_lock`).
 * On failure, logs a warning and returns true so the sync can proceed (Python behavior).
 */
export async function acquireSyncLock(log: SyncLogger): Promise<boolean> {
  const me = escapeSqlStringLiteral(lockHolderIdentity());

  try {
    const rows = await runQuery<LockRow>(
      `SELECT locked_by, locked_at FROM \`${BQ_LOCK_TABLE}\` WHERE lock_key = 'global' LIMIT 1`
    );

    if (rows.length > 0) {
      const lockedAt = parseLockedAt(coerceTimestamp(rows[0]!.locked_at));
      const ageSec = (Date.now() - lockedAt.getTime()) / 1000;
      if (ageSec < LOCK_TTL_SEC) {
        log.warn(
          `Sync already in progress by ${rows[0]!.locked_by} ` +
            `(started ${Math.floor(ageSec / 60)}m ago). Aborting to avoid duplicate imports.`
        );
        return false;
      }
      log.info("Stale lock found — clearing and acquiring.");
    }

    await executeSql(`TRUNCATE TABLE \`${BQ_LOCK_TABLE}\``);
    await executeSql(
      `INSERT INTO \`${BQ_LOCK_TABLE}\` (lock_key, locked_by, locked_at) ` +
        `VALUES ('global', '${me}', CURRENT_TIMESTAMP())`
    );
    return true;
  } catch (e) {
    log.warn(`Could not acquire BQ lock: ${e instanceof Error ? e.message : String(e)}. Proceeding without lock.`);
    return true;
  }
}

export async function releaseSyncLock(log: SyncLogger): Promise<void> {
  try {
    await executeSql(`TRUNCATE TABLE \`${BQ_LOCK_TABLE}\``);
  } catch (e) {
    log.warn(`Failed to release sync lock: ${e instanceof Error ? e.message : String(e)}`);
  }
}
