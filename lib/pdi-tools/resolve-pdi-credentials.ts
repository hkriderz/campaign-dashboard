import fs from "fs";
import path from "path";
import { parseDotEnvLines } from "@/lib/env/parse-dotenv";
import { sessionCredentialsEnabled } from "@/lib/credentials/config";
import { getActiveCredentialContext } from "@/lib/credentials/store";
import {
  resolveCredentialsDir,
  shouldUseGlobalCredentialFallback,
} from "@/lib/credentials/resolve-dir";
import type { CredentialContext } from "@/lib/credentials/types";
import { PDI_CREDENTIALS_DIR } from "@/lib/credentials/paths";

export { PDI_CREDENTIALS_DIR };

const GCP_CANDIDATE_NAMES = [
  "gcp-service-account.json",
  "google-application-credentials.json",
  "service-account.json",
] as const;

const PDI_JSON_NAMES = ["pdi-credentials.json", "pdi_credentials.json"] as const;
const PDI_ENV_NAMES = ["pdi.env", ".env.pdi"] as const;

export type CredentialSource = "credentials-folder" | "env" | "none";

export type ResolvedPdiToolsCredentials = {
  gcpCredentialsPath: string | null;
  gcpProjectId: string | null;
  pdiUsername: string | null;
  pdiPassword: string | null;
  pdiApiToken: string | null;
  gcpSource: CredentialSource;
  pdiSource: CredentialSource;
};

function isServiceAccountJson(parsed: unknown): parsed is { project_id?: string; private_key?: string; client_email?: string } {
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  return typeof o.private_key === "string" && typeof o.client_email === "string";
}

function findGcpJsonInDir(credentialsDir: string): string | null {
  if (!fs.existsSync(credentialsDir)) return null;

  for (const name of GCP_CANDIDATE_NAMES) {
    const p = path.join(credentialsDir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as unknown;
      if (isServiceAccountJson(parsed)) return path.resolve(p);
    } catch {
      continue;
    }
  }

  let fallback: string | null = null;
  const entries = fs.readdirSync(credentialsDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith(".json")) continue;
    if (PDI_JSON_NAMES.includes(ent.name as (typeof PDI_JSON_NAMES)[number])) continue;
    if (ent.name === ".session-meta.json") continue;
    const p = path.join(credentialsDir, ent.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as unknown;
      if (isServiceAccountJson(parsed)) {
        fallback = path.resolve(p);
        break;
      }
    } catch {
      continue;
    }
  }
  return fallback;
}

function readGcpProjectId(absJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(absJsonPath, "utf-8")) as { project_id?: string };
    return typeof parsed.project_id === "string" ? parsed.project_id : null;
  } catch {
    return null;
  }
}

function loadPdiFromDir(credentialsDir: string): {
  username: string | null;
  password: string | null;
  apiToken: string | null;
  filesRead: boolean;
  anyValueFromFile: boolean;
} {
  if (!fs.existsSync(credentialsDir)) {
    return { username: null, password: null, apiToken: null, filesRead: false, anyValueFromFile: false };
  }

  let username: string | null = null;
  let password: string | null = null;
  let apiToken: string | null = null;
  let filesRead = false;
  let anyValueFromFile = false;

  for (const name of PDI_JSON_NAMES) {
    const p = path.join(credentialsDir, name);
    if (!fs.existsSync(p)) continue;
    filesRead = true;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
      const u = pickStr(raw, ["PDI_USERNAME", "pdi_username", "username", "Username"]);
      const pw = pickStr(raw, ["PDI_PASSWORD", "pdi_password", "password", "Password"]);
      const t = pickStr(raw, ["PDI_API_TOKEN", "pdi_api_token", "apiToken", "ApiToken", "api_token"]);
      if (u) {
        username = u;
        anyValueFromFile = true;
      }
      if (pw) {
        password = pw;
        anyValueFromFile = true;
      }
      if (t) {
        apiToken = t;
        anyValueFromFile = true;
      }
    } catch {
      continue;
    }
  }

  for (const name of PDI_ENV_NAMES) {
    const p = path.join(credentialsDir, name);
    if (!fs.existsSync(p)) continue;
    filesRead = true;
    try {
      const kv = parseDotEnvLines(fs.readFileSync(p, "utf-8"));
      const u = kv.PDI_USERNAME ?? kv.USERNAME;
      const pw = kv.PDI_PASSWORD ?? kv.PASSWORD;
      const t = kv.PDI_API_TOKEN ?? kv.API_TOKEN;
      if (u) {
        username = u;
        anyValueFromFile = true;
      }
      if (pw) {
        password = pw;
        anyValueFromFile = true;
      }
      if (t) {
        apiToken = t;
        anyValueFromFile = true;
      }
    } catch {
      continue;
    }
  }

  return { username, password, apiToken, filesRead, anyValueFromFile };
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function activeContext(override?: CredentialContext | null): CredentialContext | undefined {
  return override ?? getActiveCredentialContext();
}

/**
 * Resolves GCP service-account path and PDI login fields for PDI Tools API routes and sync spawn.
 * When session credentials are enabled, reads from the active session directory (AsyncLocalStorage or explicit ctx).
 */
export function resolvePdiToolsCredentials(ctx?: CredentialContext | null): ResolvedPdiToolsCredentials {
  const active = activeContext(ctx);
  const credentialsDir = resolveCredentialsDir(active);
  const envFallback = shouldUseGlobalCredentialFallback(active);

  const folderGcp = findGcpJsonInDir(credentialsDir);
  const envRel = envFallback ? process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() : undefined;
  let gcpCredentialsPath: string | null = null;
  let gcpSource: CredentialSource = "none";

  if (folderGcp) {
    gcpCredentialsPath = folderGcp;
    gcpSource = "credentials-folder";
  } else if (envRel) {
    const abs = path.isAbsolute(envRel) ? envRel : path.resolve(process.cwd(), envRel);
    if (fs.existsSync(abs)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(abs, "utf-8")) as unknown;
        if (isServiceAccountJson(parsed)) {
          gcpCredentialsPath = abs;
          gcpSource = "env";
        }
      } catch {
        gcpSource = "none";
      }
    }
  }

  const gcpProjectId =
    (gcpCredentialsPath ? readGcpProjectId(gcpCredentialsPath) : null) ??
    (envFallback ? process.env.GCP_PROJECT_ID?.trim() || null : null);

  const fromDir = loadPdiFromDir(credentialsDir);
  const pdiUsername =
    fromDir.username ?? (envFallback ? process.env.PDI_USERNAME?.trim() ?? null : null);
  const pdiPassword =
    fromDir.password ?? (envFallback ? process.env.PDI_PASSWORD?.trim() ?? null : null);
  const pdiApiToken =
    fromDir.apiToken ?? (envFallback ? process.env.PDI_API_TOKEN?.trim() ?? null : null);

  const pdiComplete = Boolean(pdiUsername && pdiPassword && pdiApiToken);

  let pdiSource: CredentialSource = "none";
  if (fromDir.anyValueFromFile) {
    pdiSource = "credentials-folder";
  } else if (pdiComplete) {
    pdiSource = "env";
  }

  return {
    gcpCredentialsPath,
    gcpProjectId,
    pdiUsername,
    pdiPassword,
    pdiApiToken,
    gcpSource,
    pdiSource,
  };
}

/** Merge for `child_process` / routes so syncer and Python see the same paths as the mapper APIs. */
export function pdiToolsProcessEnv(ctx?: CredentialContext | null): NodeJS.ProcessEnv {
  const r = resolvePdiToolsCredentials(ctx);
  const merged: NodeJS.ProcessEnv = { ...process.env };
  if (r.gcpCredentialsPath) {
    merged.GOOGLE_APPLICATION_CREDENTIALS = r.gcpCredentialsPath;
  }
  if (r.gcpProjectId && !merged.GCP_PROJECT_ID) {
    merged.GCP_PROJECT_ID = r.gcpProjectId;
  }
  if (r.pdiUsername) merged.PDI_USERNAME = r.pdiUsername;
  if (r.pdiPassword) merged.PDI_PASSWORD = r.pdiPassword;
  if (r.pdiApiToken) merged.PDI_API_TOKEN = r.pdiApiToken;
  return merged;
}

export type PdiCredentialsPublicStatus = {
  credentialsDir: string;
  credentialsDirExists: boolean;
  filesInFolder: string[];
  sessionModeEnabled: boolean;
  credentialScope: "global" | "session";
  sessionScoped: boolean;
  gcp: {
    configured: boolean;
    source: CredentialSource;
    fileName: string | null;
    projectId: string | null;
  };
  pdi: {
    configured: boolean;
    source: CredentialSource;
    hasUsername: boolean;
    hasPassword: boolean;
    hasApiToken: boolean;
  };
};

export function getPdiCredentialsPublicStatus(ctx?: CredentialContext | null): PdiCredentialsPublicStatus {
  const active = activeContext(ctx);
  const credentialsDir = resolveCredentialsDir(active);
  const r = resolvePdiToolsCredentials(active);
  const credentialsDirExists = fs.existsSync(credentialsDir);
  const filesInFolder = credentialsDirExists
    ? fs
        .readdirSync(credentialsDir)
        .filter((n) => !n.startsWith(".") || n === ".session-meta.json")
        .filter((n) => n !== ".session-meta.json")
    : [];

  let gcpFileName: string | null = null;
  if (r.gcpCredentialsPath) {
    gcpFileName = path.basename(r.gcpCredentialsPath);
  }

  const scope: "global" | "session" =
    active?.scope === "session" ? "session" : "global";

  return {
    credentialsDir,
    credentialsDirExists,
    filesInFolder,
    sessionModeEnabled: sessionCredentialsEnabled(),
    credentialScope: scope,
    sessionScoped: scope === "session",
    gcp: {
      configured: Boolean(r.gcpCredentialsPath),
      source: r.gcpSource,
      fileName: gcpFileName,
      projectId: r.gcpProjectId,
    },
    pdi: {
      configured: Boolean(r.pdiUsername && r.pdiPassword && r.pdiApiToken),
      source: r.pdiSource,
      hasUsername: Boolean(r.pdiUsername),
      hasPassword: Boolean(r.pdiPassword),
      hasApiToken: Boolean(r.pdiApiToken),
    },
  };
}

export function assertValidServiceAccountJson(content: string): { project_id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("GCP file must be valid JSON");
  }
  if (!isServiceAccountJson(parsed)) {
    throw new Error("GCP file must be a service account JSON (client_email, private_key)");
  }
  const projectId = (parsed as { project_id?: string }).project_id;
  if (!projectId || typeof projectId !== "string") {
    throw new Error("GCP service account JSON must include project_id");
  }
  return { project_id: projectId };
}

export function assertValidPdiCredentialsJson(content: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("PDI credentials file must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("PDI credentials must be a JSON object");
  const o = parsed as Record<string, unknown>;
  const u = pickStr(o, ["PDI_USERNAME", "pdi_username", "username", "Username"]);
  const p = pickStr(o, ["PDI_PASSWORD", "pdi_password", "password", "Password"]);
  const t = pickStr(o, ["PDI_API_TOKEN", "pdi_api_token", "apiToken", "ApiToken", "api_token"]);
  if (!u || !p || !t) {
    throw new Error("PDI credentials JSON must include username, password, and api token fields");
  }
}

export function assertPdiEnvTextHasKeys(text: string): void {
  const kv = parseDotEnvLines(text);
  const u = kv.PDI_USERNAME ?? kv.USERNAME;
  const p = kv.PDI_PASSWORD ?? kv.PASSWORD;
  const t = kv.PDI_API_TOKEN ?? kv.API_TOKEN;
  if (!u?.trim() || !p?.trim() || !t?.trim()) {
    throw new Error(
      "PDI env text must set PDI_USERNAME, PDI_PASSWORD, and PDI_API_TOKEN (or USERNAME, PASSWORD, API_TOKEN)"
    );
  }
}
