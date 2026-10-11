import path from "path";

export function authDir(): string {
  const root = process.env.CAMPAIGN_DASHBOARD_DATA_DIR?.trim() || process.cwd();
  return path.join(root, "data", "auth");
}

export function usersFilePath(): string {
  return path.join(authDir(), "users.json");
}

export function sessionsFilePath(): string {
  return path.join(authDir(), "sessions.json");
}
