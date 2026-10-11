import { NextResponse } from "next/server";
import { clearLoginFailures, isLoginRateLimited, recordLoginFailure } from "@/lib/auth/rate-limit";
import { attachLoginCookie } from "@/lib/auth/http";
import { authenticateLogin, listPublicUsers } from "@/lib/auth/store";
import { getAuthSecret } from "@/lib/auth/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(req: Request) {
  if (!getAuthSecret()) {
    return NextResponse.json(
      { error: "CAMPAIGN_DASHBOARD_AUTH_SECRET is not set.", code: 500 },
      { status: 500 }
    );
  }

  const ip = clientIp(req);
  if (isLoginRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later.", code: 429 },
      { status: 429 }
    );
  }

  const users = await listPublicUsers();
  if (users.length === 0) {
    return NextResponse.json(
      {
        error:
          "No accounts yet. Set CAMPAIGN_DASHBOARD_ADMIN_LOGIN and CAMPAIGN_DASHBOARD_ADMIN_PASSWORD, then try again.",
        code: 503,
      },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as { login?: unknown; password?: unknown } | null;
  const login = typeof body?.login === "string" ? body.login : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const user = await authenticateLogin(login, password);
  if (!user) {
    recordLoginFailure(ip);
    return NextResponse.json({ error: "Invalid login or password.", code: 401 }, { status: 401 });
  }

  clearLoginFailures(ip);
  const response = NextResponse.json({ ok: true, login: user.login, role: user.role });
  await attachLoginCookie(response, user);
  return response;
}
