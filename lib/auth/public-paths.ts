/** Paths that do not require a signed login cookie. */

export function isPublicAuthPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname === "/api/auth/login") return true;
  if (pathname === "/api/phonebanking/bq-snapshot-refresh") return true;
  if (pathname === "/icon.png" || pathname === "/apple-icon.png") return true;
  return false;
}

/** Only same-origin relative paths. Blocks protocol-relative and login loops. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.startsWith("/login")) return "/";
  return value;
}
