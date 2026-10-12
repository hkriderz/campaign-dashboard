import { AsyncLocalStorage } from "node:async_hooks";
import { BigQuery, type Job } from "@google-cloud/bigquery";
import path from "path";
import fs from "fs";
import { appendBqCostLog, estimateBqUsd } from "./bq-cost-log";
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

export type BqQueryLabels = {
  /** Short job name stored in the spend log. No SQL text. */
  label?: string;
  /** `refresh`, `rebuild`, or another mode. */
  mode?: string;
};

const queryLabels = new AsyncLocalStorage<BqQueryLabels>();

/** Label every BigQuery job started inside `fn`. Nested calls replace the label until they return. */
export function withBqQueryLabels<T>(labels: BqQueryLabels, fn: () => Promise<T>): Promise<T> {
  return queryLabels.run(labels, fn);
}

function sanitizeBqLabel(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 63);
  return cleaned || fallback;
}

async function billedBytes(job: Job): Promise<number> {
  try {
    const [metadata] = await job.getMetadata();
    const raw = metadata?.statistics?.query?.totalBytesBilled ?? metadata?.statistics?.totalBytesProcessed;
    const bytes = Number(raw ?? 0);
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  } catch {
    return 0;
  }
}

async function logJob(job: Job, labels: BqQueryLabels): Promise<void> {
  const bytesBilled = await billedBytes(job);
  appendBqCostLog({
    at: new Date().toISOString(),
    label: sanitizeBqLabel(labels.label, "query"),
    bytesBilled,
    estimatedUsd: estimateBqUsd(bytesBilled),
  });
}

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : "";
  if (cause && !err.message.includes(cause)) return `${err.message}: ${cause}`;
  return err.message;
}

function isEmptyResponse(err: unknown): boolean {
  return errorText(err).includes("Unexpected end of JSON input");
}

async function createLabeledJob(sql: string, labels: BqQueryLabels): Promise<Job> {
  const bq = getBigQueryClient();
  const request = {
    query: sql,
    useLegacySql: false,
    labels: {
      query: sanitizeBqLabel(labels.label, "query"),
      mode: sanitizeBqLabel(labels.mode, "ad_hoc"),
    },
  };
  try {
    const [job] = await bq.createQueryJob(request);
    return job;
  } catch (err) {
    if (!isEmptyResponse(err)) throw err;
    const [job] = await bq.createQueryJob(request);
    return job;
  }
}

/**
 * Run a BigQuery SQL query and return typed rows.
 * Throws on error — callers must handle.
 */
export async function runQuery<T = Record<string, unknown>>(
  sql: string,
  labels?: BqQueryLabels
): Promise<T[]> {
  const resolved = { ...queryLabels.getStore(), ...labels };
  const job = await createLabeledJob(sql, resolved);
  try {
    const [rows] = await job.getQueryResults();
    await logJob(job, resolved);
    return rows as T[];
  } catch (err) {
    await logJob(job, resolved).catch(() => undefined);
    if (!isEmptyResponse(err)) throw err;
    const [rows] = await job.getQueryResults();
    await logJob(job, resolved).catch(() => undefined);
    return rows as T[];
  }
}

/** DDL / DML jobs that do not need returned rows (CREATE, DELETE, TRUNCATE, etc.). */
export async function executeSql(sql: string, labels?: BqQueryLabels): Promise<void> {
  const resolved = { ...queryLabels.getStore(), ...labels };
  const job = await createLabeledJob(sql, resolved);
  try {
    await job.getQueryResults();
    await logJob(job, resolved);
  } catch (err) {
    await logJob(job, resolved);
    throw err;
  }
}

export const PROJECT = process.env.GCP_PROJECT_ID ?? "starlit-link-475400-s5";
export const DATASET = process.env.BQ_DATASET ?? "l11_stw";
/** Scale to Win Text warehouse (separate from Dialer `l11_stw`). */
export const TEXT_DATASET = process.env.BQ_TEXT_DATASET ?? "l11_stw_txt";
