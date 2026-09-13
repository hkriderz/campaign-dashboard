import { NextResponse } from "next/server";
import { getSessionCookieOptions, SESSION_COOKIE_NAME, SESSION_REQUEST_HEADER } from "@/lib/credentials/config";
import { ACCESS_COOKIE_NAME } from "./config";

export function attachAccessCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(ACCESS_COOKIE_NAME, token, getSessionCookieOptions());
  return res;
}

export function readCookieValue(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1).trim());
    } catch {
      return trimmed.slice(eq + 1).trim();
    }
  }

  return undefined;
}

export function readSessionIdFromRequest(req: Request): string | undefined {
  const fromHeader = req.headers.get(SESSION_REQUEST_HEADER)?.trim();
  if (fromHeader) return fromHeader;
  return readCookieValue(req.headers.get("cookie"), SESSION_COOKIE_NAME);
}

export function readAccessTokenFromRequest(req: Request): string | undefined {
  return readCookieValue(req.headers.get("cookie"), ACCESS_COOKIE_NAME);
}

export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
