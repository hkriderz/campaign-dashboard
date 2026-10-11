"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Invalid login or password.");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--section-paper)] text-[var(--section-ink)] px-4 py-16">
      <div className="max-w-md mx-auto dash-card">
        <p className="section-kicker mb-2">Staff</p>
        <h1 className="section-hero__title text-2xl">Sign in</h1>
        <hr className="section-hero__rule" />
        <p className="section-hero__lede">Use the account an admin created for you.</p>
        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--section-muted)]">Login</span>
            <input
              type="text"
              name="login"
              autoComplete="username"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              className="dash-input w-full px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--section-muted)]">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="dash-input w-full px-3 py-2 text-sm"
              required
            />
          </label>
          {error ? (
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting || login.trim().length === 0 || password.length === 0}
            className="dash-btn-primary inline-flex px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
