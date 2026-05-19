import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/api/http";
import { getPhonebankingTags } from "@/lib/campaign-tags";
import { fetchAllTagStats } from "@/lib/queries/phonebanking";
import type { CandidateStats } from "@/lib/types";

/**
 * GET /api/phonebanking/campaigns
 * Returns aggregate stats for every phone banking candidate tag.
 */
export async function GET(req: NextRequest) {
  return withApiHandler(
    "/api/phonebanking/campaigns",
    async () => {
    const phonebankingTags = getPhonebankingTags();
    const tagIds = phonebankingTags.map((t) => t.id);
    const phoneBanksByTag = await fetchAllTagStats(tagIds);

    const stats: CandidateStats[] = phonebankingTags.map((tag) => {
      const phoneBanks = phoneBanksByTag[tag.id] ?? [];

      const totalDials = phoneBanks.reduce((s, p) => s + p.totalDials, 0);
      const totalHours =
        Math.round(phoneBanks.reduce((s, p) => s + p.totalHours, 0) * 100) / 100;

      const uniqueCallers = phoneBanks.reduce((s, p) => s + p.uniqueCallers, 0);

      const dates = phoneBanks
        .flatMap((p) => [p.firstCallDate, p.lastCallDate])
        .filter(Boolean) as string[];

      const sorted = [...dates].sort();

      return {
        tag,
        totalDials,
        uniqueCallers,
        totalHours,
        phoneBankCount: phoneBanks.length,
        firstCallDate: sorted.length ? sorted[0] : null,
        lastCallDate: sorted.length ? sorted.at(-1) ?? null : null,
        phoneBanks,
      };
    });

    return stats;
    },
    { req, requireCredentials: { gcp: true } }
  );
}
