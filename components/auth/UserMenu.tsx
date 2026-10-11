"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountMark from "@/components/auth/AccountMark";

type Me = { login: string; role: string };

export default function UserMenu() {
  const [user, setUser] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { user?: Me };
        if (!cancelled && body.user) setUser(body.user);
      } catch {
        /* leave the menu empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "/login";
  }

  if (!user) return null;
  const isAdmin = user.role === "admin" || user.role === "superadmin";

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--section-muted)]">
      <AccountMark login={user.login} size="sm" />
      <span className="hidden max-w-[8rem] truncate sm:inline" title={user.login}>
        {user.login}
      </span>
      {isAdmin ? (
        <Link href="/settings" className="hover:text-[var(--section-ink)] underline-offset-2 hover:underline">
          Settings
        </Link>
      ) : null}
      <button
        type="button"
        onClick={() => void logout()}
        className="hover:text-[var(--section-ink)] underline-offset-2 hover:underline"
      >
        Log out
      </button>
    </div>
  );
}
