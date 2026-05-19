import {
  assertValidPdiCredentialsJson,
  assertValidServiceAccountJson,
} from "@/lib/pdi-tools/resolve-pdi-credentials";

export type CombinedCredentialsParts = {
  gcpJson: string | null;
  pdiJson: string | null;
};

const GCP_NESTED_KEYS = ["gcp", "gcpServiceAccount", "googleApplicationCredentials", "serviceAccount"] as const;
const PDI_NESTED_KEYS = ["pdi", "pdiCredentials", "pdi_credentials"] as const;

const PDI_FIELD_KEYS = [
  "PDI_USERNAME",
  "pdi_username",
  "username",
  "Username",
  "PDI_PASSWORD",
  "pdi_password",
  "password",
  "Password",
  "PDI_API_TOKEN",
  "pdi_api_token",
  "apiToken",
  "ApiToken",
  "api_token",
] as const;

function pickStr(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function isServiceAccountShape(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  return typeof o.private_key === "string" && typeof o.client_email === "string";
}

function pdiFieldsFromObject(o: Record<string, unknown>): Record<string, string> | null {
  const username = pickStr(o, ["PDI_USERNAME", "pdi_username", "username", "Username"]);
  const password = pickStr(o, ["PDI_PASSWORD", "pdi_password", "password", "Password"]);
  const apiToken = pickStr(o, ["PDI_API_TOKEN", "pdi_api_token", "apiToken", "ApiToken", "api_token"]);
  if (!username || !password || !apiToken) return null;
  return {
    PDI_USERNAME: username,
    PDI_PASSWORD: password,
    PDI_API_TOKEN: apiToken,
  };
}

function nestedSection(o: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (k in o && o[k] != null && typeof o[k] === "object") {
      return o[k];
    }
  }
  return undefined;
}

function gcpObjectWithoutPdiFields(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if ((PDI_FIELD_KEYS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Parse a single JSON bundle into GCP service-account and PDI credential payloads.
 *
 * Supported shapes:
 * - `{ "gcp": { ...service account... }, "pdi": { PDI_USERNAME, PDI_PASSWORD, PDI_API_TOKEN } }`
 * - `{ "gcpServiceAccount": {...}, "pdiCredentials": {...} }` (aliases)
 * - A lone GCP service account JSON file (PDI optional)
 * - Root object with service account fields plus PDI_* keys at the top level
 */
export function parseCombinedCredentialsBundle(content: string): CombinedCredentialsParts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Credentials bundle must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credentials bundle must be a JSON object");
  }

  const root = parsed as Record<string, unknown>;

  let gcpRaw: unknown = nestedSection(root, GCP_NESTED_KEYS);
  let pdiRaw: unknown = nestedSection(root, PDI_NESTED_KEYS);

  if (!gcpRaw && isServiceAccountShape(root)) {
    gcpRaw = gcpObjectWithoutPdiFields(root);
  }

  if (!pdiRaw) {
    const fromRoot = pdiFieldsFromObject(root);
    if (fromRoot) pdiRaw = fromRoot;
  }

  if (!gcpRaw && !pdiRaw) {
    throw new Error(
      'Credentials bundle must include a "gcp" object (service account), a "pdi" object (username/password/token), or a combined service account JSON with PDI_* fields.'
    );
  }

  let gcpJson: string | null = null;
  if (gcpRaw != null) {
    if (typeof gcpRaw !== "object" || Array.isArray(gcpRaw)) {
      throw new Error('"gcp" must be a JSON object (GCP service account)');
    }
    gcpJson = JSON.stringify(gcpRaw);
    assertValidServiceAccountJson(gcpJson);
  }

  let pdiJson: string | null = null;
  if (pdiRaw != null) {
    if (typeof pdiRaw !== "object" || Array.isArray(pdiRaw)) {
      throw new Error('"pdi" must be a JSON object with PDI credentials');
    }
    pdiJson = JSON.stringify(pdiRaw);
    assertValidPdiCredentialsJson(pdiJson);
  }

  return { gcpJson, pdiJson };
}
