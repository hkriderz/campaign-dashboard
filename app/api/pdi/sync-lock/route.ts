import { NextResponse } from "next/server";
import { editorDenied } from "@/lib/auth/http";
import {
  assertDataAccessAllowed,
  CredentialsRequiredError,
  credentialsRequiredResponse,
  serverCredentialContext,
  runWithCredentialContextAsync,
} from "@/lib/credentials";
import { parsePdiSyncChannel } from "@/lib/pdi-tools/channel";
import { clearSyncLock, getSyncLockStatus } from "@/lib/pdi-tools/sync/sync-lock";

async function withSyncLockAccess<T>(req: Request, fn: () => Promise<T>): Promise<Response> {
  const ctx = serverCredentialContext();

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
  const denied = await editorDenied(req);
  if (denied) return denied;
  const channel = parsePdiSyncChannel(new URL(req.url).searchParams.get("channel"));
  return withSyncLockAccess(req, () => getSyncLockStatus(channel));
}

export async function DELETE(req: Request) {
  const denied = await editorDenied(req);
  if (denied) return denied;
  const channel = parsePdiSyncChannel(new URL(req.url).searchParams.get("channel"));
  return withSyncLockAccess(req, async () => {
    const previous = await getSyncLockStatus(channel);
    await clearSyncLock(channel);
    const current = await getSyncLockStatus(channel);
    return { ok: true, previous, current };
  });
}
