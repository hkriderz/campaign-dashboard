import { NextResponse } from "next/server";
import * as fs from "fs";
import {
  PDI_CREDENTIALS_DIR,
  assertPdiEnvTextHasKeys,
  assertValidPdiCredentialsJson,
  assertValidServiceAccountJson,
  getPdiCredentialsPublicStatus,
} from "@/lib/pdi-tools/resolve-pdi-credentials";

const MAX_FILE_BYTES = 1_500_000;

export async function GET() {
  try {
    const status = getPdiCredentialsPublicStatus();
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, code: 500 }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const gcpFile = form.get("gcpServiceAccount");
    const pdiFile = form.get("pdiCredentials");
    const pdiEnvText = form.get("pdiEnvText");

    if (!(gcpFile instanceof File) && !(pdiFile instanceof File) && typeof pdiEnvText !== "string") {
      return NextResponse.json(
        { error: "Provide at least one of: gcpServiceAccount file, pdiCredentials file, or pdiEnvText.", code: 400 },
        { status: 400 }
      );
    }

    fs.mkdirSync(PDI_CREDENTIALS_DIR, { recursive: true });

    if (gcpFile instanceof File && gcpFile.size > 0) {
      const buf = Buffer.from(await gcpFile.arrayBuffer());
      if (buf.length > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "GCP service account file is too large.", code: 400 }, { status: 400 });
      }
      const text = buf.toString("utf-8");
      assertValidServiceAccountJson(text);
      const dest = `${PDI_CREDENTIALS_DIR}/gcp-service-account.json`;
      fs.writeFileSync(dest, text, "utf-8");
    }

    if (pdiFile instanceof File && pdiFile.size > 0) {
      const buf = Buffer.from(await pdiFile.arrayBuffer());
      if (buf.length > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "PDI credentials file is too large.", code: 400 }, { status: 400 });
      }
      const text = buf.toString("utf-8");
      assertValidPdiCredentialsJson(text);
      const dest = `${PDI_CREDENTIALS_DIR}/pdi-credentials.json`;
      fs.writeFileSync(dest, text, "utf-8");
    }

    if (typeof pdiEnvText === "string" && pdiEnvText.trim()) {
      const text = pdiEnvText.trim();
      if (Buffer.byteLength(text, "utf-8") > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "PDI env text is too large.", code: 400 }, { status: 400 });
      }
      assertPdiEnvTextHasKeys(text);
      const dest = `${PDI_CREDENTIALS_DIR}/pdi.env`;
      fs.writeFileSync(dest, `${text}\n`, "utf-8");
    }

    const status = getPdiCredentialsPublicStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, code: 400 }, { status: 400 });
  }
}
