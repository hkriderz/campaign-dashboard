import "server-only";

import { cookies } from "next/headers";
import { canAdmin, canEdit, type Role } from "./roles";
import { userForSession } from "./store";
import { AUTH_COOKIE_NAME, getAuthSecret, verifyAuthToken } from "./token";

export type AuthUser = {
  id: string;
  login: string;
  role: Role;
};

export class AuthRequiredError extends Error {
  readonly status = 401;

  constructor() {
    super("Unauthorized");
    this.name = "AuthRequiredError";
  }
}

function readCookieValue(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]*)`));
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export async function getAuthUserFromToken(token: string | undefined | null): Promise<AuthUser | null> {
  const payload = await verifyAuthToken(token, getAuthSecret());
  if (!payload) return null;
  const user = await userForSession(payload.sid);
  if (!user || user.id !== payload.uid) return null;
  return { id: user.id, login: user.login, role: user.role };
}

export async function getAuthUserFromRequest(req: Request): Promise<AuthUser | null> {
  return getAuthUserFromToken(readCookieValue(req.headers.get("cookie")));
}

export async function getAuthUserFromCookies(): Promise<AuthUser | null> {
  const store = await cookies();
  return getAuthUserFromToken(store.get(AUTH_COOKIE_NAME)?.value);
}

export async function assertLiveSession(req?: Request): Promise<AuthUser> {
  const user = req ? await getAuthUserFromRequest(req) : await getAuthUserFromCookies();
  if (!user) throw new AuthRequiredError();
  return user;
}

export function userCanEdit(user: AuthUser | null): boolean {
  return Boolean(user && canEdit(user.role));
}

export function userCanAdmin(user: AuthUser | null): boolean {
  return Boolean(user && canAdmin(user.role));
}
