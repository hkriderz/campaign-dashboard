import { NextResponse } from "next/server";
import {
  assertDataAccessAllowed,
  CredentialsRequiredError,
  credentialsRequiredResponse,
  resolveContextFromRequest,
  runWithCredentialContextAsync,
} from "@/lib/credentials";
import { clearGlobalSyncLock, getSyncLockStatus } from "@/lib/pdi-tools/sync/sync-lock";

async function withSyncLockAccess<T>(req: Request, fn: () => Promise<T>): Promise<Response> {
  const ctx = resolveContextFromRequest(req);

  try {
    return await runWithCredentialContextAsync(ctx, async () => {
      assertDataAccessAllowed({ gcp: true, pdi: true });
      return NextResponse.json(await fn());
    });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, code: 500 }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return withSyncLockAccess(req, () => getSyncLockStatus());
}

export async function DELETE(req: Request) {
  return withSyncLockAccess(req, async () => {
    const previous = await getSyncLockStatus();
    await clearGlobalSyncLock();
    const current = await getSyncLockStatus();
    return { ok: true, previous, current };
  });
}
