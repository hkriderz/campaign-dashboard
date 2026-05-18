import { NextResponse } from "next/server";
import { compareSyncParity } from "@/lib/pdi-tools/sync/parity";
import type { SyncRunOptions } from "@/lib/pdi-tools/sync/types";

type ParityBody = {
  mode?: "incremental" | "range";
  start?: string;
  end?: string;
  mappingFileId?: string;
};

export async function POST(req: Request) {
  let body: ParityBody;
  try {
    body = (await req.json()) as ParityBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: 400 }, { status: 400 });
  }

  if (body.mode === "range" && !body.start?.trim()) {
    return NextResponse.json(
      { error: "For range mode, start date (YYYY-MM-DD) is required.", code: 400 },
      { status: 400 }
    );
  }

  const options: SyncRunOptions = {
    mode: body.mode === "range" ? "range" : "incremental",
    start: body.start,
    end: body.end,
    dryRun: true,
    minRecords: 0,
    mappingFileId: body.mappingFileId?.trim() || "auto",
  };

  try {
    const report = await compareSyncParity(options);
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message, code: 500 }, { status: 500 });
  }
}
