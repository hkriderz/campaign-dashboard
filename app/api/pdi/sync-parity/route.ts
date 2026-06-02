import { NextResponse } from "next/server";
import { withCredentialContext } from "@/lib/credentials";
import { compareSyncParity } from "@/lib/pdi-tools/sync/parity";
import type { SyncRunOptions } from "@/lib/pdi-tools/sync/types";
import { normalizeIsoDateRange } from "@/lib/validation/iso-date";

type ParityBody = {
  mode?: "incremental" | "range";
  start?: string;
  end?: string;
  mappingFileId?: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export const POST = withCredentialContext(
  async (req) => {
    let body: ParityBody;
    try {
      body = (await req.json()) as ParityBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body", code: 400 }, { status: 400 });
    }

    if (body.mode === "range") {
      const normalized = normalizeIsoDateRange(body.start ?? "", body.end?.trim() || todayIsoDate());
      if (!normalized.ok) {
        return NextResponse.json({ error: normalized.error, code: 400 }, { status: 400 });
      }
      body = { ...body, start: normalized.startDate, end: normalized.endDate };
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
