import { NextResponse } from "next/server";
import * as fs from "fs";
import {
  attachSessionCookie,
  resolveContextFromRequestWithSession,
  runWithCredentialContextAsync,
  sessionCredentialsEnabled,
  touchSessionMeta,
  pruneStaleSessionCredentials,
} from "@/lib/credentials";
import { ensureServerBootstrapped } from "@/lib/server/lazy-bootstrap";
import {
  assertPdiEnvTextHasKeys,
  assertValidPdiCredentialsJson,
  assertValidServiceAccountJson,
  getPdiCredentialsPublicStatus,
} from "@/lib/pdi-tools/resolve-pdi-credentials";

const MAX_FILE_BYTES = 1_500_000;

export async function GET(req: Request) {
  ensureServerBootstrapped();
  const { ctx, newSessionId } = resolveContextFromRequestWithSession(req);

  const res = await runWithCredentialContextAsync(ctx, async () => {
    try {
      const status = getPdiCredentialsPublicStatus(ctx);
      return NextResponse.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message, code: 500 }, { status: 500 });
    }
  });

  const sessionId = ctx.scope === "session" ? ctx.sessionId : newSessionId;
  return attachSessionCookie(res, sessionId);
}

export async function POST(req: Request) {
  ensureServerBootstrapped();
  const { ctx, newSessionId } = resolveContextFromRequestWithSession(req);

  const res = await runWithCredentialContextAsync(ctx, async () => {
    try {
      if (sessionCredentialsEnabled() && ctx.scope !== "session") {
        return NextResponse.json(
          {
            error:
              "Session credentials mode is on but this request has no session. Refresh the page and try again.",
            code: "SESSION_REQUIRED",
          },
          { status: 401 }
        );
      }

      const form = await req.formData();
      const gcpFile = form.get("gcpServiceAccount");
      const pdiFile = form.get("pdiCredentials");
      const pdiEnvText = form.get("pdiEnvText");

      if (!(gcpFile instanceof File) && !(pdiFile instanceof File) && typeof pdiEnvText !== "string") {
        return NextResponse.json(
          {
            error: "Provide at least one of: gcpServiceAccount file, pdiCredentials file, or pdiEnvText.",
            code: 400,
          },
          { status: 400 }
        );
      }

      const credentialsDir = ctx.credentialsDir;
      fs.mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });

      if (gcpFile instanceof File && gcpFile.size > 0) {
        const buf = Buffer.from(await gcpFile.arrayBuffer());
        if (buf.length > MAX_FILE_BYTES) {
          return NextResponse.json({ error: "GCP service account file is too large.", code: 400 }, { status: 400 });
        }
        const text = buf.toString("utf-8");
        assertValidServiceAccountJson(text);
        const dest = `${credentialsDir}/gcp-service-account.json`;
        fs.writeFileSync(dest, text, { mode: 0o600, encoding: "utf-8" });
      }

      if (pdiFile instanceof File && pdiFile.size > 0) {
        const buf = Buffer.from(await pdiFile.arrayBuffer());
        if (buf.length > MAX_FILE_BYTES) {
          return NextResponse.json({ error: "PDI credentials file is too large.", code: 400 }, { status: 400 });
        }
        const text = buf.toString("utf-8");
        assertValidPdiCredentialsJson(text);
        const dest = `${credentialsDir}/pdi-credentials.json`;
        fs.writeFileSync(dest, text, { mode: 0o600, encoding: "utf-8" });
      }

      if (typeof pdiEnvText === "string" && pdiEnvText.trim()) {
        const text = pdiEnvText.trim();
        if (Buffer.byteLength(text, "utf-8") > MAX_FILE_BYTES) {
          return NextResponse.json({ error: "PDI env text is too large.", code: 400 }, { status: 400 });
        }
        assertPdiEnvTextHasKeys(text);
        const dest = `${credentialsDir}/pdi.env`;
        fs.writeFileSync(dest, `${text}\n`, { mode: 0o600, encoding: "utf-8" });
      }

      if (ctx.scope === "session" && ctx.sessionId) {
        touchSessionMeta(ctx.sessionId);
      }

      pruneStaleSessionCredentials();

      const status = getPdiCredentialsPublicStatus(ctx);
      return NextResponse.json({ ok: true, status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message, code: 400 }, { status: 400 });
    }
  });

  const sessionId = ctx.scope === "session" ? ctx.sessionId : newSessionId;
  return attachSessionCookie(res, sessionId);
}
