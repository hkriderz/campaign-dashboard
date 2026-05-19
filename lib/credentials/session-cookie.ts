import { NextResponse } from "next/server";
import { SESSION_COOKIE_MAX_AGE_SEC, SESSION_COOKIE_NAME } from "./config";

/** Attach the anonymous session cookie to an API response. */
export function attachSessionCookie(res: NextResponse, sessionId: string | null): NextResponse {
  if (!sessionId) return res;

  res.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  });

  return res;
}
