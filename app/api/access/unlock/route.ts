import { NextResponse } from "next/server";
import { accessPasswordEnabled, getAccessPassword } from "@/lib/access/config";
import { attachAccessCookie, clientIpFromRequest, readSessionIdFromRequest } from "@/lib/access/cookies";
import {
  clearUnlockFailures,
  isUnlockRateLimited,
  recordUnlockFailure,
} from "@/lib/access/rate-limit";
import { createAccessToken, passwordsMatch } from "@/lib/access/token";
import { attachSessionCookie, createSessionId, isValidSessionId } from "@/lib/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVALID_PASSWORD = "Invalid password";
const TOO_MANY_ATTEMPTS = "Too many attempts. Try again later.";

function jsonError(error: string, code: number, sessionId: string): NextResponse {
  const res = NextResponse.json({ error, code }, { status: code });
  return attachSessionCookie(res, sessionId);
}

async function readSubmittedPassword(req: Request): Promise<string> {
  try {
    const body = (await req.json()) as { password?: unknown };
    return typeof body.password === "string" ? body.password : "";
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const ip = clientIpFromRequest(req);
  let sessionId = readSessionIdFromRequest(req);
  if (!isValidSessionId(sessionId)) {
    sessionId = createSessionId();
  }

  if (isUnlockRateLimited(sessionId, ip)) {
    return jsonError(TOO_MANY_ATTEMPTS, 429, sessionId);
  }

  const expected = getAccessPassword();
  const submitted = await readSubmittedPassword(req);
  const ok = accessPasswordEnabled() && (await passwordsMatch(submitted, expected));

  if (!ok) {
    recordUnlockFailure(sessionId, ip);
    return jsonError(INVALID_PASSWORD, 401, sessionId);
  }

  clearUnlockFailures(sessionId, ip);
  const token = await createAccessToken(sessionId, expected);
  const res = NextResponse.json({ ok: true, required: true, unlocked: true });
  attachSessionCookie(res, sessionId);
  return attachAccessCookie(res, token);
}
