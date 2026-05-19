import { BigQuery } from "@google-cloud/bigquery";
import path from "path";
import fs from "fs";
import { CredentialsRequiredError } from "@/lib/credentials/gate";
import { getActiveCredentialContext } from "@/lib/credentials/store";
import { ensureServerBootstrapped } from "@/lib/server/lazy-bootstrap";
import { applyPdiToolsEnv } from "@/lib/pdi-tools/sync/apply-env";
import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";

/**
 * Per-context BigQuery client cache (session-scoped when session credentials are enabled).
 */
const clientCache = new Map<string, BigQuery>();

function cacheKeyForContext(): string {
  const ctx = getActiveCredentialContext();
  const scope = ctx?.scope === "session" && ctx.sessionId ? ctx.sessionId : "global";
  const resolved = resolvePdiToolsCredentials();
  const credPath = resolved.gcpCredentialsPath ?? "adc";
  const projectId = resolved.gcpProjectId ?? process.env.GCP_PROJECT_ID ?? "default";
  return `${scope}:${projectId}:${credPath}`;
}

export function getBigQueryClient(): BigQuery {
  ensureServerBootstrapped();
  applyPdiToolsEnv();
  const resolved = resolvePdiToolsCredentials();
  const credPath =
    resolved.gcpCredentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ?? null;
  const projectId = resolved.gcpProjectId ?? process.env.GCP_PROJECT_ID ?? "starlit-link-475400-s5";
  const key = cacheKeyForContext();

  const cached = clientCache.get(key);
  if (cached) return cached;

  if (!credPath) {
    throw new CredentialsRequiredError(
      "GCP credentials are not configured. Upload a service account JSON on the credentials page, " +
        "or set GOOGLE_APPLICATION_CREDENTIALS / GCP_SERVICE_ACCOUNT_JSON for this environment."
    );
  }

  const abs = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
  if (!fs.existsSync(abs)) {
    throw new CredentialsRequiredError(
      `Service account key not found at: ${abs}. Upload gcp-service-account.json or update GOOGLE_APPLICATION_CREDENTIALS.`
    );
  }

  const client = new BigQuery({ projectId, keyFilename: abs });

  clientCache.set(key, client);
  return client;
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
