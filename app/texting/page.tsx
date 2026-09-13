import { getTextingTags } from "@/lib/campaign-tags";
import { fetchTextCampaignsByTag } from "@/lib/queries/texting";
import { runServerWithCredentialContext } from "@/lib/credentials";
import TextCandidateGrid from "@/components/texting/TextCandidateGrid";
import ErrorBanner from "@/components/shared/ErrorBanner";
import type { TextCandidateStats } from "@/lib/types";
import Link from "next/link";
import SectionHero from "@/components/brand/SectionHero";

export const dynamic = "force-dynamic";

export default async function TextingPage() {
  return runServerWithCredentialContext(async () => {
    const tags = getTextingTags();

    let candidates: TextCandidateStats[] = [];
    let error: string | null = null;

    try {
      candidates = await Promise.all(
        tags.map(async (tag) => {
          const campaigns = await fetchTextCampaignsByTag(tag.id);
          return {
            tag,
            campaignCount: campaigns.length,
            contactCount: campaigns.reduce((sum, c) => sum + c.contactCount, 0),
            completeCount: campaigns.filter((c) => c.status === "Complete").length,
            pendingCount: campaigns.filter((c) => c.status === "Pending").length,
          };
        })
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    return (
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <SectionHero
            className="mb-0"
            kicker="Dispatch / Text"
            title="Texting"
            lede="Scale to Win Text campaigns since Dec 1, 2025, grouped by candidate. Support and moved tags are shown on each candidate page."
          />
          <Link
            href="/phonebanking/campaign-tags"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--section-accent)] hover:underline mt-1"
          >
            Campaign tags
          </Link>
        </div>

        {error ? (
          <ErrorBanner message={error} />
        ) : (
          <section id="all-campaigns" className="scroll-mt-6">
            <TextCandidateGrid candidates={candidates} />
          </section>
        )}
      </div>
    );
  });
}
