import { NextResponse } from "next/server";
import { attachLoginCookie, isAuthUser, requireAdminUser } from "@/lib/auth/http";
import { isAssignableRole, isRole } from "@/lib/auth/roles";
import { deleteAccount, updateAccount } from "@/lib/auth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  const actor = await requireAdminUser(req);
  if (!isAuthUser(actor)) return actor;
  const { id } = await context.params;

  const body = (await req.json().catch(() => null)) as {
    password?: unknown;
    role?: unknown;
    disabled?: unknown;
  } | null;

  const password = typeof body?.password === "string" ? body.password : undefined;
  let role = body?.role === undefined ? undefined : body.role;
  if (role !== undefined && !isRole(role)) {
    return NextResponse.json({ error: "Unknown role.", code: 400 }, { status: 400 });
  }
  if (role !== undefined && role !== "superadmin" && !isAssignableRole(role)) {
    return NextResponse.json({ error: "Unknown role.", code: 400 }, { status: 400 });
  }
  const disabled = typeof body?.disabled === "boolean" ? body.disabled : undefined;

  const result = await updateAccount({
    actor,
    userId: id,
    password,
    role,
    disabled,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.status }, { status: result.status });
  }

  const response = NextResponse.json({ ok: true, user: result.user });
  if (password && actor.id === id) {
    await attachLoginCookie(response, { id: result.user.id, role: result.user.role });
  }
  return response;
}

export async function DELETE(req: Request, context: RouteContext) {
  const actor = await requireAdminUser(req);
  if (!isAuthUser(actor)) return actor;
  const { id } = await context.params;
  const result = await deleteAccount({ actor, userId: id });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.status }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
