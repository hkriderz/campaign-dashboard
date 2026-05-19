const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Edge-safe UUID (middleware + Node). */
export function createSessionId(): string {
  return crypto.randomUUID();
}

export function isValidSessionId(id: string | undefined | null): id is string {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}
