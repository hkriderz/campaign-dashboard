import { notFound } from "next/navigation";
import Link from "next/link";
import { getTagById, getTextingTags } from "@/lib/campaign-tags";
import { fetchTextCampaignsByTag, fetchTextContactTagStats } from "@/lib/queries/texting";
import { buildTextTagRollup, type TextTagQuestionBlock } from "@/lib/texting-tag-rollups";
import { runServerWithCredentialContext } from "@/lib/credentials";
import TextCampaignTable from "@/components/texting/TextCampaignTable";
import TextTagRollup from "@/components/texting/TextTagRollup";
import ErrorBanner from "@/components/shared/ErrorBanner";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ tag: string }>;
};

export default async function TextingTagPage({ params }: Props) {
  const { tag: tagId } = await params;
  const tag = getTagById(tagId);
  if (!tag) notFound();

  const allowed = new Set(getTextingTags().map((t) => t.id));
  if (!allowed.has(tag.id)) notFound();

  return runServerWithCredentialContext(async () => {
    let campaigns = [] as Awaited<ReturnType<typeof fetchTextCampaignsByTag>>;
    let tagStats = [] as Awaited<ReturnType<typeof fetchTextContactTagStats>>;
    let error: string | null = null;

    try {
      [campaigns, tagStats] = await Promise.all([
        fetchTextCampaignsByTag(tagId),
        fetchTextContactTagStats(tagId),
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const overallBlocks = buildTextTagRollup(tagStats, tagId);
    const rollupsByCampaignId: Record<string, TextTagQuestionBlock[]> = {};
    const statsByCampaign = new Map<string, typeof tagStats>();
    for (const row of tagStats) {
      const list = statsByCampaign.get(row.campaignId) ?? [];
      list.push(row);
      statsByCampaign.set(row.campaignId, list);
    }
    for (const [campaignId, rows] of statsByCampaign) {
      rollupsByCampaignId[campaignId] = buildTextTagRollup(rows, tagId);
    }

    const totalContacts = campaigns.reduce((sum, c) => sum + c.contactCount, 0);
    const completeCount = campaigns.filter((c) => c.status === "Complete").length;

    return (
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <Link
            href="/texting"
            className="text-sm font-medium text-teal-700 dark:text-teal-300 hover:underline"
          >
            ← All texting
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">{tag.label}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {campaigns.length.toLocaleString()} campaign{campaigns.length !== 1 ? "s" : ""} ·{" "}
            {completeCount.toLocaleString()} complete · {totalContacts.toLocaleString()} contacts
          </p>
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        {!error ? (
          <>
            <section className="mb-8 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">Contact tags</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Combined across this candidate’s text campaigns. Expand a row below for one send.
              </p>
              <TextTagRollup blocks={overallBlocks} contactCount={totalContacts} />
            </section>

            <TextCampaignTable
              campaigns={campaigns}
              tagColor={tag.color}
              rollupsByCampaignId={rollupsByCampaignId}
            />
          </>
        ) : null}
      </div>
    );
  });
}
