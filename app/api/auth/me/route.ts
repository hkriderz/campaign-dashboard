import { NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth/current";
import { unauthorizedJson } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorizedJson();
  return NextResponse.json({ ok: true, user });
}
