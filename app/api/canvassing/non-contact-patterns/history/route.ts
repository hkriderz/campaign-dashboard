import { NextResponse } from "next/server";
import { listHistorySummaries } from "@/lib/canvassing/non-contact-patterns/historical";
import { subtractIsoDays } from "@/lib/validation/iso-date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const to = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
    const from = url.searchParams.get("from") ?? subtractIsoDays(to, 14);
    const history = listHistorySummaries({ fromDate: from, toDate: to });
    return NextResponse.json({ ok: true, data: { from, to, history } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/non-contact-patterns/history GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 400 }, { status: 400 });
  }
}
