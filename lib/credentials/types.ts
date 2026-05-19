export type CredentialScope = "global" | "session";

/** Request-scoped credential context (browser session or global fallback). */
export type CredentialContext = {
  scope: CredentialScope;
  /** Set when `scope === "session"`. */
  sessionId: string | null;
  /** Absolute path to the credentials directory for this context. */
  credentialsDir: string;
};
