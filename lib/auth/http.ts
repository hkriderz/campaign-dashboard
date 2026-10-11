import "server-only";

import { NextResponse } from "next/server";
import { getSessionCookieOptions } from "@/lib/credentials/config";
import {
  assertLiveSession,
  AuthRequiredError,
  getAuthUserFromRequest,
  userCanAdmin,
  userCanEdit,
  type AuthUser,
} from "./current";
import { deleteSession } from "./store";
import {
  AUTH_COOKIE_MAX_AGE_SEC,
  AUTH_COOKIE_NAME,
  getAuthSecret,
  signAuthToken,
  verifyAuthToken,
} from "./token";
import type { Role } from "./roles";
import { createSession } from "./store";

export function unauthorizedJson(): NextResponse {
  return NextResponse.json({ error: "Unauthorized", code: 401 }, { status: 401 });
}

export function forbiddenJson(error = "Forbidden"): NextResponse {
  return NextResponse.json({ error, code: 403 }, { status: 403 });
}

export async function liveSessionDenied(req: Request): Promise<NextResponse | null> {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorizedJson();
  return null;
}

export async function liveSessionDeniedFromCookies(): Promise<NextResponse | null> {
  try {
    await assertLiveSession();
    return null;
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorizedJson();
    throw err;
  }
}

export async function editorDenied(req: Request): Promise<NextResponse | null> {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorizedJson();
  if (!userCanEdit(user)) return forbiddenJson();
  return null;
}

export async function adminDenied(req: Request): Promise<NextResponse | null> {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorizedJson();
  if (!userCanAdmin(user)) return forbiddenJson();
  return null;
}

export async function requireEditorUser(req: Request): Promise<AuthUser | NextResponse> {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorizedJson();
  if (!userCanEdit(user)) return forbiddenJson();
  return user;
}

export async function requireAdminUser(req: Request): Promise<AuthUser | NextResponse> {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorizedJson();
  if (!userCanAdmin(user)) return forbiddenJson();
  return user;
}

export function isAuthUser(value: AuthUser | NextResponse): value is AuthUser {
  return !(value instanceof NextResponse);
}

export async function attachLoginCookie(
  response: NextResponse,
  user: { id: string; role: Role }
): Promise<void> {
  const secret = getAuthSecret();
  if (!secret) throw new Error("CAMPAIGN_DASHBOARD_AUTH_SECRET is not set.");
  const exp = Math.floor(Date.now() / 1000) + AUTH_COOKIE_MAX_AGE_SEC;
  const sid = await createSession(user.id, exp);
  const token = await signAuthToken({ sid, uid: user.id, role: user.role, exp }, secret);
  const options = getSessionCookieOptions();
  response.cookies.set(AUTH_COOKIE_NAME, token, { ...options, maxAge: AUTH_COOKIE_MAX_AGE_SEC });
}

export async function clearLoginCookie(response: NextResponse, req?: Request): Promise<void> {
  if (req) {
    const token = req.headers.get("cookie");
    const payload = await verifyAuthToken(readAuthCookie(token), getAuthSecret());
    if (payload) await deleteSession(payload.sid);
  }
  const options = getSessionCookieOptions();
  response.cookies.set(AUTH_COOKIE_NAME, "", { ...options, maxAge: 0 });
}

function readAuthCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]*)`));
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export async function assertLiveSessionOrThrow(req?: Request): Promise<AuthUser> {
  return assertLiveSession(req);
}
