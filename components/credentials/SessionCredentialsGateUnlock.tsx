"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type StatusResponse = {
  credentialScope?: "global" | "session";
  gcp: { configured: boolean };
  pdi: { configured: boolean };
};

type Requirements = { gcp?: boolean; pdi?: boolean };

function meetsRequirements(status: StatusResponse, req: Requirements): boolean {
  if (req.gcp !== false && !status.gcp.configured) return false;
  if (req.pdi && !status.pdi.configured) return false;
  return true;
}

/**
 * When the server gate is stale but /api/pdi/credentials shows the session is ready,
 * refresh RSC and offer a direct link to the dashboard.
 */
export default function SessionCredentialsGateUnlock({
  requirements = { gcp: true },
  continueHref = "/phonebanking",
  continueLabel = "Continue to Phone Banking",
}: {
  requirements?: Requirements;
  continueHref?: string;
  continueLabel?: string;
}) {
  const router = useRouter();
  const refreshed = useRef(false);
  const [ready, setReady] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/pdi/credentials", { credentials: "same-origin" });
      const data = (await res.json()) as StatusResponse & { error?: string };
      if (!res.ok) return;
      const ok = data.credentialScope === "session" && meetsRequirements(data, requirements);
      setReady(ok);
      if (ok && !refreshed.current) {
        refreshed.current = true;
        router.refresh();
      }
    } catch {
      /* ignore */
    }
  }, [requirements, router]);

  useEffect(() => {
    void check();
  }, [check]);

  if (!ready) return null;

  return (
    <div className="mb-6 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex flex-wrap items-center gap-3">
      <p className="text-sm text-emerald-900 dark:text-emerald-100 flex-1 min-w-[12rem]">
        Your credentials are saved for this session. Open the dashboard to view data.
      </p>
      <Link
        href={continueHref}
        className="inline-flex px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
      >
        {continueLabel}
      </Link>
      <button
        type="button"
        onClick={() => {
          refreshed.current = false;
          void check();
        }}
        className="px-4 py-2 rounded-lg text-sm font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40"
      >
        Reload page
      </button>
    </div>
  );
}
