import { NextResponse } from "next/server";
import { editorDenied } from "@/lib/auth/http";
import { withCredentialContext } from "@/lib/credentials";
import { resolvePhonebankingTagForCampaignName } from "@/lib/campaign-tags";
import {
  fetchAllPhoneBankRawCallsByCampaignDay,
  isValidPhonebankingIsoDate,
} from "@/lib/queries/phonebanking";
import { normalizeIsoDateRange } from "@/lib/validation/iso-date";
import type { PhonebankTagMatch } from "@/lib/pdi-tools/premap-phonebanks";

/**
 * Dialer phonebanks that had calls on a Pacific day or range.
 * GET /api/pdi/phonebanks-for-day?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
export const GET = withCredentialContext(
  async (req) => {
    const denied = await editorDenied(req);
    if (denied) return denied;

    const url = new URL(req.url);
    const startParam = url.searchParams.get("start")?.trim() || url.searchParams.get("day")?.trim() || "";
    const endParam = url.searchParams.get("end")?.trim() || startParam;
    if (!startParam) {
      return NextResponse.json({ error: "Missing query param: start or day", code: 400 }, { status: 400 });
    }
    if (!isValidPhonebankingIsoDate(startParam) || !isValidPhonebankingIsoDate(endParam)) {
      return NextResponse.json({ error: "Invalid date (expected YYYY-MM-DD)", code: 400 }, { status: 400 });
    }
    const normalized = normalizeIsoDateRange(startParam, endParam);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error, code: 400 }, { status: 400 });
    }

    const rows = await fetchAllPhoneBankRawCallsByCampaignDay(normalized.startDate, normalized.endDate);
    const byName = new Map<
      string,
      { campaignName: string; totalCalls: number; tag: PhonebankTagMatch | null }
    >();
    for (const row of rows) {
      const campaignName = row.campaignName.trim();
      if (!campaignName) continue;
      const existing = byName.get(campaignName);
      if (existing) {
        existing.totalCalls += row.totalCalls;
        continue;
      }
      const matched = resolvePhonebankingTagForCampaignName(campaignName);
      byName.set(campaignName, {
        campaignName,
        totalCalls: row.totalCalls,
        tag: matched
          ? { id: matched.id, label: matched.label, searchTerms: matched.searchTerms }
          : null,
      });
    }

    const campaigns = [...byName.values()].sort((a, b) => a.campaignName.localeCompare(b.campaignName));
    return NextResponse.json({
      start: normalized.startDate,
      end: normalized.endDate,
      campaigns,
    });
  },
  { gcp: true }
);
