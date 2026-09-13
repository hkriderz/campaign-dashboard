import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  accessPasswordEnabled,
  getAccessPassword,
  isGatedSectionApiPath,
} from "@/lib/access/config";
import { verifyAccessToken } from "@/lib/access/token";
import {
  SESSION_COOKIE_NAME,
  SESSION_REQUEST_HEADER,
  getSessionCookieOptions,
  sessionCredentialsEnabled,
} from "@/lib/credentials/config";
import { createSessionId, isValidSessionId } from "@/lib/credentials/session-id";

export { SESSION_REQUEST_HEADER };

function denyGatedApi(sessionId: string): NextResponse {
  const response = NextResponse.json({ error: "Unauthorized", code: 401 }, { status: 401 });
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions());
  return response;
}

export async function middleware(request: NextRequest) {
  const passwordOn = accessPasswordEnabled();
  const credentialsOn = sessionCredentialsEnabled();

  if (!passwordOn && !credentialsOn) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  let sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionId(sessionId)) {
    sessionId = createSessionId();
  }
  requestHeaders.set(SESSION_REQUEST_HEADER, sessionId);

  const cookieOptions = getSessionCookieOptions();
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const accessOk =
    passwordOn && (await verifyAccessToken(sessionId, accessToken, getAccessPassword()));

  if (passwordOn && isGatedSectionApiPath(request.nextUrl.pathname) && !accessOk) {
    return denyGatedApi(sessionId);
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.cookies.set(SESSION_COOKIE_NAME, sessionId, cookieOptions);
  if (accessOk && accessToken) {
    response.cookies.set(ACCESS_COOKIE_NAME, accessToken, cookieOptions);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
