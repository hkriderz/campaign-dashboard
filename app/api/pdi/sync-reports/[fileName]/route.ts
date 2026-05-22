import * as fs from "fs/promises";
import * as path from "path";
import { NextResponse } from "next/server";
import {
  assertDataAccessAllowed,
  CredentialsRequiredError,
  credentialsRequiredResponse,
  resolveContextFromRequest,
  runWithCredentialContextAsync,
} from "@/lib/credentials";
import { resolveSyncReportFilePath } from "@/lib/pdi-tools/sync-report-files";

type RouteParams = {
  params: Promise<{ fileName: string }>;
};

function attachmentName(fileName: string): string {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function GET(req: Request, { params }: RouteParams) {
  const ctx = resolveContextFromRequest(req);
  const { fileName } = await params;

  try {
    return await runWithCredentialContextAsync(ctx, async () => {
      assertDataAccessAllowed({ gcp: true, pdi: true });
      const filePath = resolveSyncReportFilePath(fileName);
      const body = await fs.readFile(filePath);
      const safeName = attachmentName(fileName);

      return new NextResponse(body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "Cache-Control": "no-store",
        },
      });
    });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message, code: status }, { status });
  }
}
