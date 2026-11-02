import { NextResponse } from "next/server";
import {
  clearReportDefaults,
  loadReportDefaults,
  saveReportDefaults,
} from "@/lib/report-defaults/store";
import { isReportDefaultKind } from "@/lib/report-defaults/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ kind: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { kind: rawKind } = await context.params;
    if (!isReportDefaultKind(rawKind)) {
      return NextResponse.json(
        { ok: false, error: "Unknown report defaults kind", code: 400 },
        { status: 400 }
      );
    }
    const data = loadReportDefaults(rawKind);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[report-defaults GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}

export async function PUT(req: Request, context: RouteContext) {
  try {
    const { kind: rawKind } = await context.params;
    if (!isReportDefaultKind(rawKind)) {
      return NextResponse.json(
        { ok: false, error: "Unknown report defaults kind", code: 400 },
        { status: 400 }
      );
    }
    const body = (await req.json()) as { settings?: unknown };
    if (!body || typeof body !== "object" || body.settings == null) {
      return NextResponse.json(
        { ok: false, error: "Body must include settings", code: 400 },
        { status: 400 }
      );
    }
    const data = saveReportDefaults(rawKind, body.settings);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[report-defaults PUT]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { kind: rawKind } = await context.params;
    if (!isReportDefaultKind(rawKind)) {
      return NextResponse.json(
        { ok: false, error: "Unknown report defaults kind", code: 400 },
        { status: 400 }
      );
    }
    const data = clearReportDefaults(rawKind);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[report-defaults DELETE]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}
