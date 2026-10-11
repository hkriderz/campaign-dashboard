import "server-only";

type Bucket = { count: number; resetAt: number };

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const byIp = new Map<string, Bucket>();

function prune(now: number): void {
  if (byIp.size < 256) return;
  for (const [key, bucket] of byIp) {
    if (bucket.resetAt <= now) byIp.delete(key);
  }
}

export function isLoginRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = byIp.get(ip);
  if (!bucket || bucket.resetAt <= now) return false;
  return bucket.count >= MAX_FAILURES;
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  prune(now);
  const existing = byIp.get(ip);
  if (!existing || existing.resetAt <= now) {
    byIp.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  existing.count += 1;
}

export function clearLoginFailures(ip: string): void {
  byIp.delete(ip);
}
