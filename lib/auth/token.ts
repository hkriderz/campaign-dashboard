/**
 * Edge-safe signed login cookie. The session id inside is also stored hashed on disk
 * so logout, disable, and password changes can revoke it from Node route handlers.
 */

import type { Role } from "./roles";
import { isRole } from "./roles";

export const AUTH_COOKIE_NAME = "cd_auth";

/** Login cookie lifetime. Matches the session row. */
export const AUTH_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

const DEV_AUTH_SECRET = "dev-only-campaign-dashboard-auth-secret";

export type AuthTokenPayload = {
  sid: string;
  uid: string;
  role: Role;
  exp: number;
};

export function getAuthSecret(): string {
  const raw = process.env.CAMPAIGN_DASHBOARD_AUTH_SECRET?.trim() ?? "";
  if (raw) return raw;
  if (process.env.NODE_ENV === "production") return "";
  return DEV_AUTH_SECRET;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string | null {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

export async function signAuthToken(payload: AuthTokenPayload, secret: string): Promise<string> {
  if (!secret) throw new Error("CAMPAIGN_DASHBOARD_AUTH_SECRET is not set.");
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSha256Hex(secret, body);
  return `${body}.${sig}`;
}

export async function verifyAuthToken(
  token: string | undefined | null,
  secret: string,
  nowMs = Date.now()
): Promise<AuthTokenPayload | null> {
  if (!secret || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const providedHex = token.slice(dot + 1);
  const expectedHex = await hmacSha256Hex(secret, body);
  const expected = hexToBytes(expectedHex);
  const provided = hexToBytes(providedHex);
  if (!expected || !provided || provided.length !== expected.length) return null;
  if (!timingSafeEqualBytes(expected, provided)) return null;

  const json = base64UrlDecode(body);
  if (!json) return null;
  let parsed: Partial<AuthTokenPayload>;
  try {
    parsed = JSON.parse(json) as Partial<AuthTokenPayload>;
  } catch {
    return null;
  }
  if (!parsed.sid || !parsed.uid || !isRole(parsed.role) || typeof parsed.exp !== "number") return null;
  if (parsed.exp * 1000 <= nowMs) return null;
  return { sid: parsed.sid, uid: parsed.uid, role: parsed.role, exp: parsed.exp };
}
