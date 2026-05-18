import fs from "fs";
import path from "path";
import { applyPdiToolsEnv } from "@/lib/pdi-tools/sync/apply-env";
import { resolvePdiToolsCredentials } from "@/lib/pdi-tools/resolve-pdi-credentials";

let bootstrapped = false;

/**
 * One-time server bootstrap for Docker/VPS:
 * - Merges credentials/ + env into process.env (PDI Tools)
 * - Writes GCP key from `GCP_SERVICE_ACCOUNT_JSON` when no key file exists yet
 */
export function bootstrapServerEnv(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  materializeGcpKeyFromEnv();
  applyPdiToolsEnv();
}

function materializeGcpKeyFromEnv(): void {
  const resolved = resolvePdiToolsCredentials();
  if (resolved.gcpCredentialsPath && fs.existsSync(resolved.gcpCredentialsPath)) {
    return;
  }

  const inline = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
  if (!inline) return;

  let jsonText: string;
  try {
    if (inline.startsWith("{")) {
      jsonText = inline;
    } else {
      jsonText = Buffer.from(inline, "base64").toString("utf-8");
    }
    JSON.parse(jsonText);
  } catch {
    console.error(
      "[bootstrap] GCP_SERVICE_ACCOUNT_JSON must be raw JSON or base64-encoded JSON"
    );
    return;
  }

  const dir = path.join(process.cwd(), "credentials");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, "gcp-service-account.json");
  fs.writeFileSync(dest, jsonText, { encoding: "utf-8", mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = dest;

  try {
    const parsed = JSON.parse(jsonText) as { project_id?: string };
    if (parsed.project_id && !process.env.GCP_PROJECT_ID) {
      process.env.GCP_PROJECT_ID = parsed.project_id;
    }
  } catch {
    /* validated above */
  }
}

/** Writable path for persistent data on Dokploy (mount a volume here). */
export function resolveDataRoot(): string {
  return process.env.CAMPAIGN_DASHBOARD_DATA_DIR?.trim() || process.cwd();
}

/** Ensure snapshot / upload dirs exist under the data root. */
export function ensureRuntimeDataDirs(): void {
  const root = resolveDataRoot();
  const dirs = [
    path.join(root, "data", "bq-snapshots"),
    path.join(root, "credentials"),
    path.join(root, "pdi-mappings"),
    path.join(root, "pdi-sync-exports"),
  ];
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
  }
}
