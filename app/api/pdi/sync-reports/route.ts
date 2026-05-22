import { NextResponse } from "next/server";
import {
  assertDataAccessAllowed,
  CredentialsRequiredError,
  credentialsRequiredResponse,
  resolveContextFromRequest,
  runWithCredentialContextAsync,
} from "@/lib/credentials";
import { listSyncReportFiles } from "@/lib/pdi-tools/sync-report-files";

export async function GET(req: Request) {
  const ctx = resolveContextFromRequest(req);

  try {
    return await runWithCredentialContextAsync(ctx, async () => {
      assertDataAccessAllowed({ gcp: true, pdi: true });
      return NextResponse.json(listSyncReportFiles());
    });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, code: 500 }, { status: 500 });
  }
}
