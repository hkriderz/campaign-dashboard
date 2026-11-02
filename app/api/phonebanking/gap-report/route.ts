import { NextResponse } from "next/server";
import { analyzePhonebankGapCalls } from "@/lib/phonebanking/gap-report/engine";
import { fetchPhonebankGapCallsForDay } from "@/lib/phonebanking/gap-report/query";
import {
  builtInPhonebankGapShiftSettings,
  currentLaTimeHm,
} from "@/lib/phonebanking/gap-report/shift";
import type { PhonebankGapShiftSettings } from "@/lib/phonebanking/gap-report/types";
import { isValidPhonebankingIsoDate } from "@/lib/queries/phonebanking";
import { CredentialsRequiredError } from "@/lib/credentials/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseShiftSettings(raw: unknown): PhonebankGapShiftSettings {
  const seed = builtInPhonebankGapShiftSettings();
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hm = (value: unknown, fallback: string) =>
    typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
  return {
    startTime: hm(obj.startTime, seed.startTime),
    lunchClockOutTime: hm(obj.lunchClockOutTime, seed.lunchClockOutTime),
    lunchReturnTime: hm(obj.lunchReturnTime, seed.lunchReturnTime),
    endTime: hm(obj.endTime, seed.endTime),
    preLunchBreakStart: hm(obj.preLunchBreakStart, seed.preLunchBreakStart),
    postLunchBreakStart: hm(obj.postLunchBreakStart, seed.postLunchBreakStart),
    asOfTime: hm(obj.asOfTime, currentLaTimeHm()),
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      workDate?: string;
      tagId?: string | null;
      shiftSettings?: unknown;
    };
    const workDate = typeof body.workDate === "string" ? body.workDate.trim() : "";
    if (!isValidPhonebankingIsoDate(workDate)) {
      return NextResponse.json(
        { ok: false, error: "workDate must be YYYY-MM-DD", code: 400 },
        { status: 400 }
      );
    }

    const shiftSettings = parseShiftSettings(body.shiftSettings);
    const tagId =
      typeof body.tagId === "string" && body.tagId.trim() && body.tagId.trim() !== "all"
        ? body.tagId.trim()
        : null;

    const calls = await fetchPhonebankGapCallsForDay({ workDate, tagId });
    const result = analyzePhonebankGapCalls(calls, workDate, shiftSettings);
    return NextResponse.json({ ok: true, data: { result } });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: 401 },
        { status: 401 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[phonebanking/gap-report POST]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
}
