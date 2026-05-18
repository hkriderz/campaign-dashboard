import { Suspense } from "react";
import { fetchAllActivePhoneBankSummaries, fetchAllTagStats } from "@/lib/queries/phonebanking";
import { getPhonebankingTags } from "@/lib/campaign-tags";
import CandidateGrid from "@/components/phonebanking/CandidateGrid";
import AllCampaignsDaySection from "@/components/phonebanking/AllCampaignsDaySection";
import TagDataRefreshBar from "@/components/phonebanking/TagDataRefreshBar";
import { getPhonebankingSnapshotsMeta } from "@/lib/tag-dashboard-snapshot";
import type { CandidateStats, PhoneBankSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PhoneBankingPage() {
  const phonebankingTags = getPhonebankingTags();
  const snapshotsMeta = getPhonebankingSnapshotsMeta(phonebankingTags.map((t) => t.id));

  let candidates: CandidateStats[] = [];
  let error: string | null = null;
  let allCampaigns: PhoneBankSummary[] = [];
  let allCampaignsError: string | null = null;

  try {
    const tagIds = phonebankingTags.map((t) => t.id);
    const phoneBanksByTag = await fetchAllTagStats(tagIds);

    candidates = phonebankingTags.map((tag) => {
      const phoneBanks = phoneBanksByTag[tag.id] ?? [];
      const totalDials = phoneBanks.reduce((s, p) => s + p.totalDials, 0);
      const totalHours =
        Math.round(phoneBanks.reduce((s, p) => s + p.totalHours, 0) * 100) /
        100;
      const uniqueCallers = phoneBanks.reduce(
        (s, p) => s + p.uniqueCallers,
        0
      );
      const dates = phoneBanks
        .flatMap((p) => [p.firstCallDate, p.lastCallDate])
        .filter(Boolean) as string[];

      return {
        tag,
        totalDials,
        uniqueCallers,
        totalHours,
        phoneBankCount: phoneBanks.length,
        firstCallDate: dates.length ? dates.sort()[0] : null,
        lastCallDate: dates.length ? dates.sort().at(-1) ?? null : null,
        phoneBanks,
      };
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  try {
    allCampaigns = await fetchAllActivePhoneBankSummaries();
  } catch (err) {
    allCampaignsError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Phone Banking</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Active, complete, and archived campaigns since Dec 1, 2025, grouped by candidate. Click a candidate to see
          individual phone banks.
        </p>
      </div>

      <div className="mb-6">
        <TagDataRefreshBar
          enabled={Boolean(process.env.CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET)}
          dataUpdatedAtIso={snapshotsMeta.dataUpdatedAt}
          dataUpdatedAtLabel={snapshotsMeta.dataUpdatedAtLabel}
          isStale={snapshotsMeta.isStale}
          hasSnapshotData={snapshotsMeta.hasDailyCaller}
        />
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4">
          <p className="font-semibold text-red-800 dark:text-red-300 text-sm">
            Error loading data
          </p>
          <p className="text-red-600 dark:text-red-300 text-xs mt-1 font-mono">{error}</p>
          <p className="text-red-500 dark:text-red-300 text-xs mt-2">
            Make sure <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">.env.local</code>{" "}
            is configured and the service account JSON is in the project root.
          </p>
        </div>
      ) : (
        <CandidateGrid candidates={candidates} />
      )}

      <section id="all-campaigns" className="mt-12 scroll-mt-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">All campaigns</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
          Same lifecycle and date window as candidate views, without filtering by name. Includes campaigns that
          do not match any candidate tag (e.g. Ada). Use <strong className="font-medium">Filter by day</strong> to load
          a single Pacific calendar day (extra BigQuery reads only when a date is chosen).
        </p>
        {allCampaignsError ? (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200">
            Could not load all-campaigns list:{" "}
            <span className="font-mono text-xs">{allCampaignsError}</span>
          </div>
        ) : (
          <Suspense
            fallback={<p className="text-sm text-gray-500 dark:text-gray-400 py-2">Loading filters…</p>}
          >
            <AllCampaignsDaySection defaultPhoneBanks={allCampaigns} />
          </Suspense>
        )}
      </section>
    </div>
  );
}
