import "server-only";

import fs from "fs";
import path from "path";
import { PDI_CREDENTIALS_DIR } from "@/lib/credentials/paths";
import { sessionCredentialsTtlHours } from "./config";
import { isValidSessionId } from "./session-id";

export const SESSIONS_ROOT = path.join(PDI_CREDENTIALS_DIR, "sessions");

export { createSessionId, isValidSessionId } from "./session-id";

export function getSessionCredentialsDir(sessionId: string): string {
  return path.join(SESSIONS_ROOT, sessionId);
}

export function ensureSessionCredentialsDir(sessionId: string): string {
  const dir = getSessionCredentialsDir(sessionId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const SESSION_META = ".session-meta.json";

export function touchSessionMeta(sessionId: string): void {
  const dir = ensureSessionCredentialsDir(sessionId);
  const metaPath = path.join(dir, SESSION_META);
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ sessionId, updatedAt: new Date().toISOString() }),
    "utf-8"
  );
}

/** Remove stale session credential directories. Safe to call on startup or after uploads. */
export function pruneStaleSessionCredentials(): number {
  if (!fs.existsSync(SESSIONS_ROOT)) return 0;

  const ttlMs = sessionCredentialsTtlHours() * 3600 * 1000;
  const cutoff = Date.now() - ttlMs;
  let removed = 0;

  for (const ent of fs.readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!ent.isDirectory() || !isValidSessionId(ent.name)) continue;

    const dir = path.join(SESSIONS_ROOT, ent.name);
    const metaPath = path.join(dir, SESSION_META);
    let mtime = 0;

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { updatedAt?: string };
        mtime = meta.updatedAt ? Date.parse(meta.updatedAt) : 0;
      } catch {
        mtime = 0;
      }
    }

    if (!mtime) {
      try {
        mtime = fs.statSync(dir).mtimeMs;
      } catch {
        continue;
      }
    }

    if (mtime < cutoff) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      } catch {
        /* ignore */
      }
    }
  }

  return removed;
}
