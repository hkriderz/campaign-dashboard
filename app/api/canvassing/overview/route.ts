import { NextResponse } from "next/server";
import { appendKnockEventsToIndex } from "@/lib/canvassing/knock-index-store";
import { buildKnockEvents, parseCanvassingUploadFile } from "@/lib/canvassing/knock-details-parser";
import { readCanvassingUploadFormFiles } from "@/lib/canvassing/upload-form";
import {
  CredentialsRequiredError,
  credentialsRequiredResponse,
  withCredentialContext,
} from "@/lib/credentials";
import { buildUniqueIdOverviewCsv, buildUniqueIdOverviewPayload } from "@/lib/unique-ids/payload";
import { parseUniqueIdOverviewForm, parseUniqueIdOverviewQuery } from "@/lib/unique-ids/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCredentialContext(async (req) => {
  try {
    const query = parseUniqueIdOverviewQuery(new URL(req.url));
    if (query.format === "csv") {
      const result = await buildUniqueIdOverviewCsv(query);
      if (!result.csv) {
        return NextResponse.json({ ok: false, error: result.error || "No unique IDs to export.", code: 400 }, { status: 400 });
      }
      return new NextResponse(result.csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
        },
      });
    }
    const data = await buildUniqueIdOverviewPayload(query);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/overview GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
});

export const POST = withCredentialContext(async (req) => {
  try {
    const form = await req.formData();
    const files = await readCanvassingUploadFormFiles(form);
    const parsed = (await Promise.all(files.map((file) => parseCanvassingUploadFile(file)))).flat();
    const knock = buildKnockEvents(parsed);
    if (!knock.events.length) {
      return NextResponse.json(
        { ok: false, error: "No Canvasser Details knock rows found in the upload.", code: 400 },
        { status: 400 }
      );
    }
    const appended = appendKnockEventsToIndex(knock.events, {
      source: "overview",
      fileNames: files.map((file) => file.fileName),
    });
    const query = parseUniqueIdOverviewForm(form);
    const data = await buildUniqueIdOverviewPayload(query);
    return NextResponse.json({ ok: true, data: { import: appended.importMeta, ...data } }, { status: 201 });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/overview POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
});
