import "server-only";

import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { accountMutationError, type AccountActor, type AccountMutation } from "./policy";
import { hashPassword, passwordTooShort, verifyPassword } from "./password";
import { authDir, sessionsFilePath, usersFilePath } from "./paths";
import type { AssignableRole, Role } from "./roles";
import { isRole } from "./roles";

export type StoredUser = {
  id: string;
  login: string;
  passwordHash: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
};

export type PublicUser = {
  id: string;
  login: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
};

type StoredSession = {
  tokenHash: string;
  userId: string;
  expiresAt: number;
};

type UserFile = { users: StoredUser[] };
type SessionFile = { sessions: StoredSession[] };

let writeChain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function ensureAuthDir(): void {
  fs.mkdirSync(authDir(), { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  ensureAuthDir();
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    fs.renameSync(tmp, filePath);
  } catch {
    fs.copyFileSync(tmp, filePath);
    fs.rmSync(tmp, { force: true });
  }
}

function readUsers(): StoredUser[] {
  const parsed = readJson<UserFile>(usersFilePath(), { users: [] });
  if (!parsed || !Array.isArray(parsed.users)) return [];
  return parsed.users.filter(
    (user) =>
      user &&
      typeof user.id === "string" &&
      typeof user.login === "string" &&
      typeof user.passwordHash === "string" &&
      isRole(user.role)
  );
}

function writeUsers(users: StoredUser[]): void {
  writeJson(usersFilePath(), { users });
}

function readSessions(): StoredSession[] {
  const parsed = readJson<SessionFile>(sessionsFilePath(), { sessions: [] });
  if (!parsed || !Array.isArray(parsed.sessions)) return [];
  return parsed.sessions.filter(
    (session) =>
      session &&
      typeof session.tokenHash === "string" &&
      typeof session.userId === "string" &&
      typeof session.expiresAt === "number"
  );
}

function writeSessions(sessions: StoredSession[]): void {
  writeJson(sessionsFilePath(), { sessions });
}

export function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    login: user.login,
    role: user.role,
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
  };
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function findUserByLogin(users: StoredUser[], login: string): StoredUser | undefined {
  const key = normalizeLogin(login);
  return users.find((user) => user.login === key);
}

export function bootstrapAdminConfig(): { login: string; password: string } | null {
  const login = process.env.CAMPAIGN_DASHBOARD_ADMIN_LOGIN?.trim() ?? "";
  const password = process.env.CAMPAIGN_DASHBOARD_ADMIN_PASSWORD ?? "";
  if (!login || !password) return null;
  return { login, password };
}

/** Create the superadmin once, when the user file has no accounts. */
export async function ensureSuperadminBootstrap(): Promise<void> {
  await withLock(async () => {
    ensureAuthDir();
    const users = readUsers();
    if (users.length > 0) return;
    const config = bootstrapAdminConfig();
    if (!config) return;
    if (passwordTooShort(config.password)) {
      console.error(
        "[auth] CAMPAIGN_DASHBOARD_ADMIN_PASSWORD must be at least 8 characters. Superadmin was not created."
      );
      return;
    }
    const user: StoredUser = {
      id: randomBytes(16).toString("hex"),
      login: normalizeLogin(config.login),
      passwordHash: await hashPassword(config.password),
      role: "superadmin",
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    writeUsers([user]);
  });
}

export async function authenticateLogin(
  login: string,
  password: string
): Promise<StoredUser | null> {
  await ensureSuperadminBootstrap();
  const users = readUsers();
  const user = findUserByLogin(users, login);
  if (!user || user.disabled) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

export async function createSession(userId: string, expiresAtSec: number): Promise<string> {
  const sessionId = randomBytes(32).toString("hex");
  await withLock(async () => {
    const now = Math.floor(Date.now() / 1000);
    const sessions = readSessions().filter((session) => session.expiresAt > now);
    sessions.push({ tokenHash: hashSessionId(sessionId), userId, expiresAt: expiresAtSec });
    writeSessions(sessions);
  });
  return sessionId;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const tokenHash = hashSessionId(sessionId);
  await withLock(async () => {
    writeSessions(readSessions().filter((session) => session.tokenHash !== tokenHash));
  });
}

async function deleteUserSessions(userId: string): Promise<void> {
  await withLock(async () => {
    writeSessions(readSessions().filter((session) => session.userId !== userId));
  });
}

export async function userForSession(sessionId: string): Promise<StoredUser | null> {
  const tokenHash = hashSessionId(sessionId);
  const now = Math.floor(Date.now() / 1000);
  const session = readSessions().find((row) => row.tokenHash === tokenHash && row.expiresAt > now);
  if (!session) return null;
  const user = readUsers().find((row) => row.id === session.userId);
  if (!user || user.disabled) return null;
  return user;
}

export async function listPublicUsers(): Promise<PublicUser[]> {
  await ensureSuperadminBootstrap();
  return readUsers()
    .map(toPublicUser)
    .sort((a, b) => a.login.localeCompare(b.login));
}

function actorOf(user: StoredUser): AccountActor {
  return { id: user.id, role: user.role };
}

export async function createAccount(input: {
  actor: AccountActor;
  login: string;
  password: string;
  role: AssignableRole;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string; status: number }> {
  const policyError = accountMutationError(input.actor, null, { action: "create", role: input.role });
  if (policyError) return { ok: false, error: policyError, status: 403 };
  const login = normalizeLogin(input.login);
  if (!login || !/^[a-z0-9._@+-]{2,80}$/.test(login)) {
    return { ok: false, error: "Login must be 2–80 characters: letters, digits, and . _ @ + -.", status: 400 };
  }
  if (passwordTooShort(input.password)) {
    return { ok: false, error: "Password must be at least 8 characters.", status: 400 };
  }

  return withLock(async () => {
    const users = readUsers();
    if (findUserByLogin(users, login)) {
      return { ok: false, error: "That login already exists.", status: 409 };
    }
    const user: StoredUser = {
      id: randomBytes(16).toString("hex"),
      login,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    writeUsers([...users, user]);
    return { ok: true, user: toPublicUser(user) };
  });
}

export async function updateAccount(input: {
  actor: AccountActor;
  userId: string;
  password?: string;
  role?: Role;
  disabled?: boolean;
}): Promise<{ ok: true; user: PublicUser } | { ok: false; error: string; status: number }> {
  const users = readUsers();
  const target = users.find((user) => user.id === input.userId);
  if (!target) return { ok: false, error: "Account not found.", status: 404 };

  const mutations: AccountMutation[] = [];
  if (typeof input.password === "string") mutations.push({ action: "password" });
  if (input.role !== undefined) mutations.push({ action: "role", role: input.role });
  if (input.disabled !== undefined) mutations.push({ action: "disable" });
  if (mutations.length === 0) return { ok: false, error: "Nothing to update.", status: 400 };

  for (const mutation of mutations) {
    const policyError = accountMutationError(input.actor, actorOf(target), mutation);
    if (policyError) return { ok: false, error: policyError, status: 403 };
  }
  if (typeof input.password === "string" && passwordTooShort(input.password)) {
    return { ok: false, error: "Password must be at least 8 characters.", status: 400 };
  }

  const next: StoredUser = { ...target };
  if (typeof input.password === "string") next.passwordHash = await hashPassword(input.password);
  if (input.role !== undefined && input.role !== "superadmin") next.role = input.role;
  if (input.disabled !== undefined) next.disabled = input.disabled;

  await withLock(async () => {
    const latest = readUsers();
    const index = latest.findIndex((user) => user.id === target.id);
    if (index === -1) return;
    latest[index] = next;
    writeUsers(latest);
  });

  if (typeof input.password === "string" || next.disabled) {
    await deleteUserSessions(target.id);
  }

  return { ok: true, user: toPublicUser(next) };
}

export async function deleteAccount(input: {
  actor: AccountActor;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const target = readUsers().find((user) => user.id === input.userId);
  if (!target) return { ok: false, error: "Account not found.", status: 404 };
  const policyError = accountMutationError(input.actor, actorOf(target), { action: "delete" });
  if (policyError) return { ok: false, error: policyError, status: 403 };

  await withLock(async () => {
    writeUsers(readUsers().filter((user) => user.id !== target.id));
  });
  await deleteUserSessions(target.id);
  return { ok: true };
}

export function authFilesExistForTests(): { users: string; sessions: string } {
  return { users: usersFilePath(), sessions: path.dirname(usersFilePath()) };
}
