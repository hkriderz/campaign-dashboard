"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AccessStatus = {
  required?: boolean;
  unlocked?: boolean;
  error?: string;
};

function isUnlocked(status: AccessStatus): boolean {
  return status.required === false || status.unlocked === true;
}

export default function SessionPasswordGateClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "ready" | "needs">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const checkSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/access/status", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await res.json()) as AccessStatus;
      if (!res.ok) return false;
      return isUnlocked(data);
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await checkSession();
      if (!cancelled) setPhase(ok ? "ready" : "needs");
    })();
    return () => {
      cancelled = true;
    };
  }, [checkSession]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/access/unlock", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as AccessStatus;

      if (res.status === 429) {
        setError(data.error || "Too many attempts. Try again later.");
        return;
      }

      if (!res.ok) {
        setError("Invalid password");
        return;
      }

      setPassword("");
      setPhase("ready");
      router.refresh();
    } catch {
      setError("Invalid password");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--section-muted)]">
        Checking access…
      </div>
    );
  }

  if (phase === "ready") {
    return <>{children}</>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8 dash-card">
        <p className="section-kicker mb-2">Restricted</p>
        <h1 className="section-hero__title text-2xl">Enter the access password</h1>
        <hr className="section-hero__rule" />
        <p className="section-hero__lede">
          Canvassing and District Classifier are locked for this browser session. Enter the staff
          password once to unlock both sections.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <label className="block">
            <span className="sr-only">Access password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="dash-input w-full px-3 py-2 text-sm"
              placeholder="Password"
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
            disabled={submitting || password.length === 0}
            className="dash-btn-primary inline-flex px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
