import { BigQuery } from "@google-cloud/bigquery";
import path from "path";
import fs from "fs";
import { applyPdiToolsEnv } from "@/lib/pdi-tools/sync/apply-env";
import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";

/**
 * Singleton BigQuery client.
 * Resolves GCP via `credentials/` folder, env vars, or `GCP_SERVICE_ACCOUNT_JSON` (see bootstrap).
 */
let _client: BigQuery | null = null;
let _clientKey: string | null = null;

export function getBigQueryClient(): BigQuery {
  applyPdiToolsEnv();
  const resolved = resolvePdiToolsCredentials();
  const credPath =
    resolved.gcpCredentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ?? null;
  const projectId = resolved.gcpProjectId ?? process.env.GCP_PROJECT_ID ?? "starlit-link-475400-s5";
  const cacheKey = `${projectId}:${credPath ?? "adc"}`;

  if (_client && _clientKey === cacheKey) return _client;
  _clientKey = cacheKey;

  if (credPath) {
    const abs = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `Service account key not found at: ${abs}. ` +
          `Upload gcp-service-account.json to credentials/ or set GOOGLE_APPLICATION_CREDENTIALS.`
      );
    }
    _client = new BigQuery({ projectId, keyFilename: abs });
  } else {
    _client = new BigQuery({ projectId });
  }

  return _client;
}

/**
 * Run a BigQuery SQL query and return typed rows.
 * Throws on error — callers must handle.
 */
export async function runQuery<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({ query: sql, useLegacySql: false });
  return rows as T[];
}

/** DDL / DML jobs that do not need returned rows (CREATE, DELETE, TRUNCATE, etc.). */
export async function executeSql(sql: string): Promise<void> {
  const bq = getBigQueryClient();
  await bq.query({ query: sql, useLegacySql: false });
}

export const PROJECT = process.env.GCP_PROJECT_ID ?? "starlit-link-475400-s5";
export const DATASET = process.env.BQ_DATASET ?? "l11_stw";
