"use client";

import { useCallback, useEffect, useState } from "react";
import AccountMark from "@/components/auth/AccountMark";
import { roleLabel, type AssignableRole, type Role } from "@/lib/auth/roles";

type Account = {
  id: string;
  login: string;
  role: Role;
  disabled: boolean;
};

const ASSIGNABLE: AssignableRole[] = ["viewer", "editor", "admin"];

export default function SettingsClient() {
  const [actorId, setActorId] = useState("");
  const [users, setUsers] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AssignableRole>("viewer");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/accounts", { cache: "no-store", credentials: "same-origin" });
    const body = (await res.json().catch(() => ({}))) as {
      users?: Account[];
      actorId?: string;
      error?: string;
    };
    if (!res.ok) {
      setError(body.error || "Could not load accounts.");
      return;
    }
    setUsers(body.users ?? []);
    setActorId(body.actorId ?? "");
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/accounts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password, role }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || "Could not create the account.");
        return;
      }
      setLogin("");
      setPassword("");
      setRole("viewer");
      setNotice("Account created.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, okMessage: string) {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/auth/accounts/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error || "Update failed.");
      return;
    }
    setNotice(okMessage);
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this account?")) return;
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/auth/accounts/${id}`, { method: "DELETE", credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error || "Delete failed.");
      return;
    }
    setNotice("Account deleted.");
    await load();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <p className="section-kicker">Admin</p>
        <h1 className="font-display text-3xl font-semibold text-[var(--section-ink)]">Accounts</h1>
        <hr className="section-hero__rule" />
        <p className="section-hero__lede">
          Create staff logins and set passwords. The superadmin account stays protected from other admins.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p> : null}

      <form onSubmit={createAccount} className="dash-card space-y-3">
        <p className="text-sm font-semibold text-[var(--section-ink)]">New account</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--section-muted)]">Login</span>
            <input
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              className="dash-input w-full px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--section-muted)]">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="dash-input w-full px-3 py-2 text-sm"
              required
              minLength={8}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--section-muted)]">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as AssignableRole)}
              className="dash-input w-full px-3 py-2 text-sm"
            >
              {ASSIGNABLE.map((option) => (
                <option key={option} value={option}>
                  {roleLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" disabled={busy} className="dash-btn-primary px-4 py-2 text-sm disabled:opacity-60">
          Create account
        </button>
      </form>

      <ul className="divide-y divide-[var(--section-rule)] border-y border-[var(--section-rule)]">
        {users.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            isSelf={account.id === actorId}
            onPatch={patch}
            onDelete={remove}
          />
        ))}
      </ul>
    </div>
  );
}

function AccountRow({
  account,
  isSelf,
  onPatch,
  onDelete,
}: {
  account: Account;
  isSelf: boolean;
  onPatch: (id: string, body: Record<string, unknown>, okMessage: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AssignableRole>(
    account.role === "superadmin" ? "admin" : account.role
  );
  const protectedAccount = account.role === "superadmin";
  const canChangePassword = !protectedAccount || isSelf;
  const canManage = !protectedAccount && !isSelf;

  return (
    <li className="py-4">
      <div className="flex gap-3">
        <AccountMark login={account.login} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-[var(--section-ink)]">{account.login}</p>
            <span className="inline-flex items-center rounded-full border border-[var(--section-rule)] px-2 py-0.5 text-xs text-[var(--section-muted)]">
              {roleLabel(account.role)}
            </span>
            {account.disabled ? (
              <span className="inline-flex items-center rounded-full border border-red-300 px-2 py-0.5 text-xs text-red-700 dark:text-red-300">
                Disabled
              </span>
            ) : null}
            {protectedAccount && !isSelf ? (
              <span className="text-xs text-[var(--section-muted)]">Protected</span>
            ) : null}
          </div>
          {canChangePassword ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void onPatch(account.id, { password }, "Password updated.");
                setPassword("");
              }}
            >
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--section-muted)]">New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  className="dash-input px-3 py-2 text-sm"
                  required
                />
              </label>
              <button type="submit" className="dash-btn-primary px-3 py-2 text-xs">
                Save password
              </button>
            </form>
          ) : null}
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as AssignableRole)}
                className="dash-input px-3 py-2 text-sm"
                aria-label={`Role for ${account.login}`}
              >
                {ASSIGNABLE.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel(option)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="border border-[var(--section-rule)] px-3 py-2 text-xs"
                onClick={() => void onPatch(account.id, { role }, "Role updated.")}
              >
                Save role
              </button>
              <button
                type="button"
                className="border border-[var(--section-rule)] px-3 py-2 text-xs"
                onClick={() =>
                  void onPatch(
                    account.id,
                    { disabled: !account.disabled },
                    account.disabled ? "Account enabled." : "Account disabled."
                  )
                }
              >
                {account.disabled ? "Enable" : "Disable"}
              </button>
              <button
                type="button"
                className="border border-red-300 px-3 py-2 text-xs text-red-700"
                onClick={() => void onDelete(account.id)}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
