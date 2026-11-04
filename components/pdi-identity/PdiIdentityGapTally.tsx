"use client";

import type { PdiIdentityGapTally } from "@/lib/pdi-identity/gaps";

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function Chip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warn" | "ok";
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
      : tone === "ok"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
        : "border-gray-200 bg-gray-50 text-gray-800 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{formatNumber(value)}</div>
    </div>
  );
}

export default function PdiIdentityGapTallyChips({
  gaps,
  loading,
}: {
  gaps: PdiIdentityGapTally | null | undefined;
  loading?: boolean;
}) {
  if (loading && !gaps) {
    return <p className="text-xs text-gray-500">Counting missing names and addresses…</p>;
  }
  if (!gaps) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Chip label="Unique IDs" value={gaps.uniqueIdCount} />
        <Chip
          label="Missing name"
          value={gaps.missingName}
          tone={gaps.missingName > 0 ? "warn" : "ok"}
        />
        <Chip
          label="Missing address"
          value={gaps.missingAddress}
          tone={gaps.missingAddress > 0 ? "warn" : "ok"}
        />
        <Chip
          label="Missing both"
          value={gaps.missingBoth}
          tone={gaps.missingBoth > 0 ? "warn" : "ok"}
        />
        <Chip label="Identities saved" value={gaps.identitiesSaved} tone="neutral" />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Counts use Unique IDs in the current date range
        {gaps.uniqueIdCount
          ? " (after identity-store fill). Importing names/addresses lowers the missing tallies."
          : ". Select or refresh Unique IDs data to populate the gap tallies."}
      </p>
    </div>
  );
}
