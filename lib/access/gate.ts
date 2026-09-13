import "server-only";

import { accessPasswordEnabled, getAccessPassword } from "./config";
import { readAccessTokenFromRequest, readSessionIdFromRequest } from "./cookies";
import { verifyAccessToken } from "./token";

export class SectionAccessRequiredError extends Error {
  readonly code = 401;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "SectionAccessRequiredError";
  }
}

export async function isSectionAccessUnlocked(req: Request): Promise<boolean> {
  if (!accessPasswordEnabled()) return true;
  const password = getAccessPassword();
  const sessionId = readSessionIdFromRequest(req);
  const token = readAccessTokenFromRequest(req);
  return verifyAccessToken(sessionId, token, password);
}

export async function assertSectionAccessAllowed(req: Request): Promise<void> {
  if (await isSectionAccessUnlocked(req)) return;
  throw new SectionAccessRequiredError();
}
