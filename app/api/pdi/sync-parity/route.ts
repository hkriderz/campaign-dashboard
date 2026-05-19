import { NextResponse } from "next/server";
import { withCredentialContext } from "@/lib/credentials";
import { compareSyncParity } from "@/lib/pdi-tools/sync/parity";
import type { SyncRunOptions } from "@/lib/pdi-tools/sync/types";

type ParityBody = {
  mode?: "incremental" | "range";
  start?: string;
  end?: string;
  mappingFileId?: string;
};

export const POST = withCredentialContext(
  async (req) => {
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

    const report = await compareSyncParity(options);
    return NextResponse.json(report);
  },
  { gcp: true, pdi: true }
);
