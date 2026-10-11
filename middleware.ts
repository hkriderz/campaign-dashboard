import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPublicAuthPath, safeNextPath } from "@/lib/auth/public-paths";
import { AUTH_COOKIE_NAME, getAuthSecret, verifyAuthToken } from "@/lib/auth/token";
import {
  SESSION_COOKIE_NAME,
  SESSION_REQUEST_HEADER,
  getSessionCookieOptions,
  sessionCredentialsEnabled,
} from "@/lib/credentials/config";
import { createSessionId, isValidSessionId } from "@/lib/credentials/session-id";

export { SESSION_REQUEST_HEADER };

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-cd-pathname", request.nextUrl.pathname);

  const credentialsOn = sessionCredentialsEnabled();
  let sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (credentialsOn && !isValidSessionId(sessionId)) {
    sessionId = createSessionId();
  }
  if (credentialsOn && sessionId) {
    requestHeaders.set(SESSION_REQUEST_HEADER, sessionId);
  }

  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const authOk = Boolean(await verifyAuthToken(token, getAuthSecret()));
  const cookieOptions = getSessionCookieOptions();

  const attachSession = (response: NextResponse) => {
    if (credentialsOn && sessionId) {
      response.cookies.set(SESSION_COOKIE_NAME, sessionId, cookieOptions);
    }
    return response;
  };

  if (!isPublicAuthPath(pathname) && !authOk) {
    if (pathname.startsWith("/api/")) {
      return attachSession(
        NextResponse.json({ error: "Unauthorized", code: 401 }, { status: 401 })
      );
    }
    const login = new URL("/login", request.url);
    const next = safeNextPath(`${pathname}${search}`);
    if (next !== "/") login.searchParams.set("next", next);
    return attachSession(NextResponse.redirect(login));
  }

  return attachSession(
    NextResponse.next({
      request: { headers: requestHeaders },
    })
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
