import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  litFlagRowsToIndexRows,
  parseLitFlagsCsv,
} from "@/lib/canvassing/lit-flags-parser";
import {
  appendKnockIndexRows,
  loadKnockIndex,
  type KnockIndexImportMeta,
} from "@/lib/canvassing/knock-index-store";
import type { QcCanvassKnockIndexRow } from "@/lib/qc-recontact/types";
import {
  CredentialsRequiredError,
  credentialsRequiredResponse,
  withCredentialContext,
} from "@/lib/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type LitFlagsImportPayload = {
  importMeta: KnockIndexImportMeta;
  litRows: number;
  flyerRows: number;
  skippedOther: number;
  skippedNoPrimaryId: number;
  skippedUnclassified: number;
  issues: Array<{ rowNumber: number; message: string }>;
  rowCount: number;
};

export type LitFlagsListPayload = {
  imports: KnockIndexImportMeta[];
};

export const GET = withCredentialContext(async () => {
  try {
    const index = loadKnockIndex();
    const imports = index.imports
      .filter((item) => item.source === "lit-flags")
      .slice()
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    const data: LitFlagsListPayload = { imports };
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/canvassers/lit/flags GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
});

export const POST = withCredentialContext(async (req) => {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) {
      return NextResponse.json(
        { ok: false, error: "Upload at least one lit flags CSV.", code: 400 },
        { status: 400 }
      );
    }

    const allRows: QcCanvassKnockIndexRow[] = [];
    let litRows = 0;
    let flyerRows = 0;
    let skippedOther = 0;
    let skippedNoPrimaryId = 0;
    let skippedUnclassified = 0;
    const issues: Array<{ rowNumber: number; message: string }> = [];
    const fileNames: string[] = [];
    const reportId = crypto.randomUUID();

    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".csv")) {
        return NextResponse.json(
          { ok: false, error: `Unsupported file type for "${file.name}". Upload CSV files.`, code: 400 },
          { status: 400 }
        );
      }
      if (file.size === 0) {
        return NextResponse.json(
          { ok: false, error: `"${file.name}" is empty.`, code: 400 },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { ok: false, error: `"${file.name}" is too large. Maximum file size is 25 MB.`, code: 400 },
          { status: 400 }
        );
      }

      const text = Buffer.from(await file.arrayBuffer()).toString("utf-8");
      const parsed = parseLitFlagsCsv(text, file.name);
      litRows += parsed.litRows;
      flyerRows += parsed.flyerRows;
      skippedOther += parsed.skippedOther;
      skippedNoPrimaryId += parsed.skippedNoPrimaryId;
      skippedUnclassified += parsed.skippedUnclassified;
      issues.push(...parsed.issues);
      fileNames.push(file.name);
      allRows.push(...litFlagRowsToIndexRows(parsed, reportId));
    }

    if (!allRows.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "No Lit Observation or flyer flag rows found in the upload.",
          code: 400,
          data: { litRows, flyerRows, skippedOther, skippedNoPrimaryId, skippedUnclassified, issues: issues.slice(0, 50) },
        },
        { status: 400 }
      );
    }

    const result = appendKnockIndexRows(allRows, {
      source: "lit-flags",
      reportId,
      fileNames,
    });

    const data: LitFlagsImportPayload = {
      importMeta: result.importMeta,
      litRows,
      flyerRows,
      skippedOther,
      skippedNoPrimaryId,
      skippedUnclassified,
      issues: issues.slice(0, 50),
      rowCount: result.rowCount,
    };
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/canvassers/lit/flags POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
});
