import { NextResponse } from "next/server";
import { isAuthUser, requireAdminUser } from "@/lib/auth/http";
import { isAssignableRole } from "@/lib/auth/roles";
import { createAccount, listPublicUsers } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await requireAdminUser(req);
  if (!isAuthUser(actor)) return actor;
  const users = await listPublicUsers();
  return NextResponse.json({ ok: true, users, actorId: actor.id });
}

export async function POST(req: Request) {
  const actor = await requireAdminUser(req);
  if (!isAuthUser(actor)) return actor;

  const body = (await req.json().catch(() => null)) as {
    login?: unknown;
    password?: unknown;
    role?: unknown;
  } | null;
  const login = typeof body?.login === "string" ? body.login : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!isAssignableRole(body?.role)) {
    return NextResponse.json(
      { error: "Role must be viewer, editor, or admin.", code: 400 },
      { status: 400 }
    );
  }

  const result = await createAccount({ actor, login, password, role: body.role });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.status }, { status: result.status });
  }
  return NextResponse.json({ ok: true, user: result.user });
}
