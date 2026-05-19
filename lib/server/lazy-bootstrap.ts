import fs from "fs";
import path from "path";
import { sessionCredentialsEnabled } from "@/lib/credentials/config";

let bootstrapped = false;
let deferredStarted = false;

const CREDENTIALS_DIR = path.join(process.cwd(), "credentials");
const GLOBAL_GCP_KEY = path.join(CREDENTIALS_DIR, "gcp-service-account.json");

/**
 * One-time server bootstrap (GCP key materialization, data dirs, env merge).
 * Called lazily from server entry points — not from `instrumentation.ts`, because
 * Next.js webpack cannot bundle Node `fs`/`path` in the instrumentation hook graph.
 */
export function ensureServerBootstrapped(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  materializeGcpKeyFromEnv();
  ensureRuntimeDataDirs();

  if (!deferredStarted) {
    deferredStarted = true;
    void runDeferredBootstrapTasksOnce().catch((err) => {
      console.error("[lazy-bootstrap] deferred tasks failed:", err);
    });
  }
}

function materializeGcpKeyFromEnv(): void {
  if (fs.existsSync(GLOBAL_GCP_KEY)) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = GLOBAL_GCP_KEY;
    }
    return;
  }

  const envRel = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (envRel) {
    const abs = path.isAbsolute(envRel) ? envRel : path.resolve(process.cwd(), envRel);
    if (fs.existsSync(abs)) return;
  }

  const inline = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (!inline) return;

  let jsonText: string;
  try {
    jsonText = inline.startsWith("{")
      ? inline
      : Buffer.from(inline, "base64").toString("utf-8");
    JSON.parse(jsonText);
  } catch {
    console.error(
      "[bootstrap] GCP_SERVICE_ACCOUNT_JSON must be raw JSON or base64-encoded JSON"
    );
    return;
  }

  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(GLOBAL_GCP_KEY, jsonText, { encoding: "utf-8", mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = GLOBAL_GCP_KEY;

  try {
    const parsed = JSON.parse(jsonText) as { project_id?: string };
    if (parsed.project_id && !process.env.GCP_PROJECT_ID) {
      process.env.GCP_PROJECT_ID = parsed.project_id;
    }
  } catch {
    /* validated above */
  }
}

async function runDeferredBootstrapTasksOnce(): Promise<void> {
  if (!sessionCredentialsEnabled()) {
    const { applyPdiToolsEnv } = await import("@/lib/pdi-tools/sync/apply-env");
    applyPdiToolsEnv();
  }

  const { pruneStaleSessionCredentials } = await import("@/lib/credentials/session");
  pruneStaleSessionCredentials();
}

export function resolveDataRoot(): string {
  return process.env.CAMPAIGN_DASHBOARD_DATA_DIR?.trim() || process.cwd();
}

export function ensureRuntimeDataDirs(): void {
  const root = resolveDataRoot();
  const dirs = [
    path.join(root, "data", "bq-snapshots"),
    path.join(root, "credentials"),
    path.join(root, "credentials", "sessions"),
    path.join(root, "pdi-mappings"),
    path.join(root, "pdi-sync-exports"),
  ];
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** @deprecated Use ensureServerBootstrapped */
export function bootstrapServerEnv(): void {
  ensureServerBootstrapped();
}

export async function runDeferredBootstrapTasks(): Promise<void> {
  await runDeferredBootstrapTasksOnce();
}
