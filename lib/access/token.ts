/**
 * Edge-safe HMAC unlock token and timing-safe password compare.
 * Cookie value is HMAC-SHA256(sessionId) keyed by the access password — not the password itself.
 */

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
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

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
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

/** SHA-256 both sides so length differences do not leak via timingSafeEqual. */
export async function passwordsMatch(submitted: string, expected: string): Promise<boolean> {
  const a = await sha256Bytes(submitted);
  const b = await sha256Bytes(expected);
  return timingSafeEqualBytes(a, b);
}

export async function createAccessToken(sessionId: string, password: string): Promise<string> {
  if (!sessionId || !password) {
    throw new Error("Cannot create an access token without a session and password.");
  }
  return hmacSha256Hex(password, sessionId);
}

export async function verifyAccessToken(
  sessionId: string | undefined | null,
  token: string | undefined | null,
  password: string
): Promise<boolean> {
  if (!sessionId || !password) return false;

  const expected = await hmacSha256Hex(password, sessionId);
  const expectedBytes = hexToBytes(expected);
  if (!expectedBytes) return false;

  const provided = typeof token === "string" ? token.trim().toLowerCase() : "";
  const providedBytes = hexToBytes(provided);
  if (!providedBytes || providedBytes.length !== expectedBytes.length) {
    timingSafeEqualBytes(expectedBytes, expectedBytes);
    return false;
  }

  return timingSafeEqualBytes(expectedBytes, providedBytes);
}
