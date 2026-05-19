import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_REQUEST_HEADER,
  getSessionCookieOptions,
  sessionCredentialsEnabled,
} from "@/lib/credentials/config";
import { createSessionId, isValidSessionId } from "@/lib/credentials/session-id";

export { SESSION_REQUEST_HEADER };

export function middleware(request: NextRequest) {
  if (!sessionCredentialsEnabled()) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  let sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionId(sessionId)) {
    sessionId = createSessionId();
  }

  requestHeaders.set(SESSION_REQUEST_HEADER, sessionId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Re-issue every response so Max-Age slides and Secure matches current env (fixes HTTP deploys).
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions());

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
