import "server-only";

import { UNLOCK_RATE_LIMIT_MAX, UNLOCK_RATE_LIMIT_WINDOW_MS } from "./config";

type Bucket = {
  count: number;
  resetAt: number;
};

const bySession = new Map<string, Bucket>();
const byIp = new Map<string, Bucket>();

function pruneMap(map: Map<string, Bucket>, now: number): void {
  if (map.size < 256) return;
  for (const [key, bucket] of map) {
    if (bucket.resetAt <= now) map.delete(key);
  }
}

function getBucket(map: Map<string, Bucket>, key: string, now: number): Bucket {
  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh: Bucket = { count: 0, resetAt: now + UNLOCK_RATE_LIMIT_WINDOW_MS };
    map.set(key, fresh);
    return fresh;
  }
  return existing;
}

function isBucketLimited(map: Map<string, Bucket>, key: string, now: number): boolean {
  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) return false;
  return existing.count >= UNLOCK_RATE_LIMIT_MAX;
}

export function isUnlockRateLimited(sessionId: string | null | undefined, ip: string): boolean {
  const now = Date.now();
  const sessionLimited = sessionId ? isBucketLimited(bySession, sessionId, now) : false;
  return sessionLimited || isBucketLimited(byIp, ip, now);
}

export function recordUnlockFailure(sessionId: string | null | undefined, ip: string): void {
  const now = Date.now();
  pruneMap(bySession, now);
  pruneMap(byIp, now);
  if (sessionId) {
    getBucket(bySession, sessionId, now).count += 1;
  }
  getBucket(byIp, ip, now).count += 1;
}

export function clearUnlockFailures(sessionId: string | null | undefined, ip: string): void {
  if (sessionId) bySession.delete(sessionId);
  byIp.delete(ip);
}
