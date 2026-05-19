import { notFound } from "next/navigation";
import Link from "next/link";
import { fetchPhoneBankDetail } from "@/lib/queries/phonebanking";
import { runServerWithCredentialContext } from "@/lib/credentials";
import PhoneBankDetailClient from "@/components/phonebanking/PhoneBankDetailClient";
import ErrorBanner from "@/components/shared/ErrorBanner";

export const dynamic = "force-dynamic";

const NEUTRAL_COLOR = "#64748b";

type Props = {
  params: Promise<{ campaignId: string }>;
};

/** Campaign detail reached from the all-campaigns list (no candidate tag in URL). */
export default async function PhoneBankCampaignOnlyPage({ params }: Props) {
  return runServerWithCredentialContext(async () => {
  const { campaignId } = await params;

  let detail = null;
  let error: string | null = null;

  try {
    detail = await fetchPhoneBankDetail(campaignId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!error && !detail) notFound();

  return (
    <div className="max-w-6xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-5 flex-wrap">
        <Link href="/phonebanking" className="hover:text-indigo-600 transition-colors">
          Phone Banking
        </Link>
        <span>/</span>
        <Link href="/phonebanking#all-campaigns" className="hover:text-indigo-600 transition-colors">
          All campaigns
        </Link>
        <span>/</span>
        <span className="text-gray-700 dark:text-gray-200 font-medium truncate max-w-xs">
          {detail?.campaign.campaignName ?? campaignId}
        </span>
      </nav>

      <div className="flex items-start gap-3 mb-6">
        <span
          className="w-4 h-4 rounded-full flex-shrink-0 mt-1"
          style={{ backgroundColor: NEUTRAL_COLOR }}
        />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-snug">
            {detail?.campaign.campaignName ?? "Phone Bank Details"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">All campaigns</p>
        </div>
      </div>

      {error ? (
        <ErrorBanner message={error} />
      ) : (
        detail && <PhoneBankDetailClient detail={detail} tagColor={NEUTRAL_COLOR} />
      )}
    </div>
  );
  });
}
