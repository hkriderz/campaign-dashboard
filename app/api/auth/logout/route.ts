import { NextResponse } from "next/server";
import { clearLoginCookie } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const response = NextResponse.json({ ok: true });
  await clearLoginCookie(response, req);
  return response;
}
