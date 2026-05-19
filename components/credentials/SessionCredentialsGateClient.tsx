"use client";

import { useCallback, useEffect, useState } from "react";
import PdiCredentialsSection from "@/components/pdi-tools/PdiCredentialsSection";

type DataAccessRequirements = {
  gcp?: boolean;
  pdi?: boolean;
};

type CredentialStatus = {
  credentialScope?: "global" | "session";
  gcp: { configured: boolean };
  pdi: { configured: boolean };
};

function meetsRequirements(status: CredentialStatus, req: DataAccessRequirements): boolean {
  if (req.gcp !== false && !status.gcp.configured) return false;
  if (req.pdi && !status.pdi.configured) return false;
  return true;
}

function isSessionReady(status: CredentialStatus, req: DataAccessRequirements): boolean {
  return status.credentialScope === "session" && meetsRequirements(status, req);
}

type Props = {
  children: React.ReactNode;
  requirements?: DataAccessRequirements;
  title?: string;
  description?: string;
};

/**
 * Client gate: uses the same /api/pdi/credentials session as uploads so the UI
 * never disagrees with the server RSC cookie/header resolution.
 */
export default function SessionCredentialsGateClient({
  children,
  requirements = { gcp: true },
  title = "Upload your credentials",
  description = "Each browser session requires its own GCP and PDI credentials. Upload the files below to access dashboard data. Nothing is shared with other visitors.",
}: Props) {
  const [phase, setPhase] = useState<"loading" | "ready" | "needs">("loading");

  const checkSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/pdi/credentials", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await res.json()) as CredentialStatus & { error?: string };
      if (!res.ok) return false;
      return isSessionReady(data, requirements);
    } catch {
      return false;
    }
  }, [requirements]);

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

  const onCredentialsSaved = useCallback(() => {
    const href = requirements.pdi ? "/pdi/mapper" : "/phonebanking";
    window.location.assign(href);
  }, [requirements.pdi]);

  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500 dark:text-gray-400">
        Checking credentials…
      </div>
    );
  }

  if (phase === "ready") {
    return <>{children}</>;
  }

  const needsPdi = Boolean(requirements.pdi);
  const needsGcp = requirements.gcp !== false;
  const continueHref = needsPdi ? "/pdi/mapper" : "/phonebanking";

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-6">
        <h1 className="text-xl font-bold text-amber-950 dark:text-amber-100">{title}</h1>
        <p className="text-sm text-amber-900/90 dark:text-amber-200/90 mt-2">{description}</p>
        <ul className="mt-3 text-sm text-amber-800 dark:text-amber-300 list-disc list-inside space-y-1">
          {needsGcp ? <li>GCP service account JSON (BigQuery access)</li> : null}
          {needsPdi ? <li>PDI username, password, and API token</li> : null}
        </ul>
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Credentials are stored only for this browser session on the server and are not visible to other users.
        </p>
      </div>
      <PdiCredentialsSection
        sessionMode
        redirectAfterSave={continueHref}
        gateRequirements={requirements}
        onCredentialsSaved={onCredentialsSaved}
      />
    </div>
  );
}
