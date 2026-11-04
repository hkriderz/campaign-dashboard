import { NextResponse } from "next/server";
import { scanPdiIdentityCsv } from "@/lib/pdi-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing CSV file.", code: 400 }, { status: 400 });
    }
    const text = await file.text();
    const scan = scanPdiIdentityCsv(text);
    if (!scan.columns.length) {
      return NextResponse.json(
        { ok: false, error: "CSV has no header row.", code: 400 },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, data: { scan, fileName: file.name } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pdi-identity scan]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}
