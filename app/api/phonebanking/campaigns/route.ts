import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/api/http";
import { getPhonebankingTags } from "@/lib/campaign-tags";
import { fetchTagDailyCallerStats } from "@/lib/queries/phonebanking";
import { getTombstonedSliceKeys } from "@/lib/csv-slice-tombstones";
import { buildCandidateStatsFromDailyCallerStats } from "@/lib/phonebanking-candidate-stats";

/**
 * GET /api/phonebanking/campaigns
 * Returns aggregate stats for every phone banking candidate tag.
 */
export async function GET(req: NextRequest) {
  return withApiHandler(
    "/api/phonebanking/campaigns",
    async () => {
    const phonebankingTags = getPhonebankingTags();
    const stats = await Promise.all(
      phonebankingTags.map(async (tag) => {
        const rows = await fetchTagDailyCallerStats(tag.id);
        return buildCandidateStatsFromDailyCallerStats(tag, rows, getTombstonedSliceKeys(tag.id));
      })
    );

    return stats;
    },
    { req, requireCredentials: { gcp: true } }
  );
}
