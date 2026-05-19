import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getSessionCookieOptions } from "./config";

/** Attach the anonymous session cookie to an API response (re-issued every credentials call). */
export function attachSessionCookie(res: NextResponse, sessionId: string | null): NextResponse {
  if (!sessionId) return res;

  res.cookies.set(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions());
  return res;
}
