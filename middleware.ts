import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_MAX_AGE_SEC,
  SESSION_COOKIE_NAME,
  SESSION_REQUEST_HEADER,
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
  let setCookie = false;

  if (!isValidSessionId(sessionId)) {
    sessionId = createSessionId();
    setCookie = true;
  }

  requestHeaders.set(SESSION_REQUEST_HEADER, sessionId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  if (setCookie) {
    response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SEC,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
