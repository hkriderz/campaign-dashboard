import { NextResponse } from "next/server";
import { accessPasswordEnabled } from "@/lib/access/config";
import { readSessionIdFromRequest } from "@/lib/access/cookies";
import { isSectionAccessUnlocked } from "@/lib/access/gate";
import { attachSessionCookie, isValidSessionId } from "@/lib/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const required = accessPasswordEnabled();
  const unlocked = required ? await isSectionAccessUnlocked(req) : true;
  const sessionId = readSessionIdFromRequest(req);
  const res = NextResponse.json({ required, unlocked });
  return attachSessionCookie(res, isValidSessionId(sessionId) ? sessionId : null);
}
