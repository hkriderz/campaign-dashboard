import { pdiToolsProcessEnv } from "@/lib/pdi-tools/resolve-pdi-credentials";

/** Apply resolved PDI/GCP credentials to `process.env` before BigQuery or PDI calls. */
export function applyPdiToolsEnv(): void {
  const merged = pdiToolsProcessEnv();
  if (merged.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = merged.GOOGLE_APPLICATION_CREDENTIALS;
  }
  if (merged.GCP_PROJECT_ID) {
    process.env.GCP_PROJECT_ID = merged.GCP_PROJECT_ID;
  }
  if (merged.PDI_USERNAME) process.env.PDI_USERNAME = merged.PDI_USERNAME;
  if (merged.PDI_PASSWORD) process.env.PDI_PASSWORD = merged.PDI_PASSWORD;
  if (merged.PDI_API_TOKEN) process.env.PDI_API_TOKEN = merged.PDI_API_TOKEN;
}
