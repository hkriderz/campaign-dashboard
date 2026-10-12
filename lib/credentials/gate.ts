import "server-only";

import {
  getPdiCredentialsPublicStatus,
  type PdiCredentialsPublicStatus,
} from "@/lib/pdi-tools/resolve-pdi-credentials";
import { sessionCredentialsEnabled } from "./config";
import { getActiveCredentialContext } from "./store";
import type { CredentialContext } from "./types";

export class CredentialsRequiredError extends Error {
  readonly code = "CREDENTIALS_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "CredentialsRequiredError";
  }
}

export type DataAccessRequirements = {
  gcp?: boolean;
  pdi?: boolean;
};

export function getCredentialStatus(ctx?: CredentialContext | null): PdiCredentialsPublicStatus {
  return getPdiCredentialsPublicStatus(ctx ?? getActiveCredentialContext() ?? undefined);
}

export function isGcpConfigured(ctx?: CredentialContext | null): boolean {
  return getCredentialStatus(ctx).gcp.configured;
}

export function isPdiConfigured(ctx?: CredentialContext | null): boolean {
  return getCredentialStatus(ctx).pdi.configured;
}

export function meetsDataAccessRequirements(
  ctx: CredentialContext | null | undefined,
  req: DataAccessRequirements
): boolean {
  const status = getCredentialStatus(ctx);
  if (req.gcp && !status.gcp.configured) return false;
  if (req.pdi && !status.pdi.configured) return false;
  return true;
}

function missingCredentialsMessage(requirements: DataAccessRequirements): string {
  const parts: string[] = [];
  if (requirements.gcp) parts.push("GCP service account");
  if (requirements.pdi) parts.push("PDI API credentials");
  return `This server is missing ${parts.join(" and ")}.`;
}

export function assertDataAccessAllowed(requirements: DataAccessRequirements = { gcp: true }): void {
  if (!sessionCredentialsEnabled()) return;

  const ctx = getActiveCredentialContext();
  if (!meetsDataAccessRequirements(ctx, requirements)) {
    throw new CredentialsRequiredError(missingCredentialsMessage(requirements));
  }
}

export function credentialsRequiredResponse(message: string): Response {
  return Response.json({ error: message, code: "CREDENTIALS_REQUIRED" }, { status: 401 });
}
