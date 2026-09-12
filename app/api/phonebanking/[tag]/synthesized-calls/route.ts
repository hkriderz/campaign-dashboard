import { NextRequest } from "next/server";
import { apiError, withApiHandler } from "@/lib/api/http";
import { getTagById, resolveSurveyScriptProfile } from "@/lib/campaign-tags";
import { fetchTagCallSurveyRowsForFinalFill } from "@/lib/queries/phonebanking";
import { canonicalizePhonebankerName } from "@/lib/phonebanker-name";
import {
  candidateTermsForTag,
  listSynthesizedFinalResults,
  type SynthesizedFinalResultHit,
} from "@/lib/strong-support-from-survey";
import {
  finalResultFamilyForDisplayLabel,
  synthesizedHitMatchesLabel,
  type FinalResultFamily,
} from "@/lib/survey-answer-consolidation";

const MAX_HITS = 500;
const FAMILIES = new Set<FinalResultFamily>([
  "strongSupport",
  "undecided",
  "strongOppose",
  "other",
]);

function firstParam(value: string | null): string {
  return (value ?? "").trim();
}

function parseFamily(raw: string): FinalResultFamily | null {
  if (!raw) return null;
  if (FAMILIES.has(raw as FinalResultFamily)) return raw as FinalResultFamily;
  return null;
}

function inDateRange(value: string, start: string, end: string): boolean {
  if (!start) return true;
  if (!end || end === start) return value === start;
  return value >= start && value <= end;
}

/**
 * GET /api/phonebanking/[tag]/synthesized-calls
 * Call-level provenance for Final Result fills (missing FR, filled from polling/ID).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tag: string }> }
) {
  const { tag: tagId } = await params;
  const tag = getTagById(tagId);
  if (!tag) {
    return apiError(`Unknown tag: ${tagId}`, 404);
  }

  const url = req.nextUrl;
  const campaignId = firstParam(url.searchParams.get("campaignId"));
  const callDate = firstParam(url.searchParams.get("callDate"));
  const endDate = firstParam(url.searchParams.get("endDate"));
  const phonebanker = firstParam(url.searchParams.get("phonebanker"));
  const displayLabel = firstParam(url.searchParams.get("displayLabel"));
  const familyRaw = firstParam(url.searchParams.get("family"));
  const family = parseFamily(familyRaw);
  if (familyRaw && !family) {
    return apiError(`Invalid family: ${familyRaw}`, 400);
  }

  return withApiHandler(
    `/api/phonebanking/${tagId}/synthesized-calls`,
    async () => {
      const fill = await fetchTagCallSurveyRowsForFinalFill(tagId);
      const profile = resolveSurveyScriptProfile(tag);
      let hits: SynthesizedFinalResultHit[] = listSynthesizedFinalResults(
        fill,
        profile,
        candidateTermsForTag(tag)
      );

      if (campaignId) {
        hits = hits.filter((h) => h.campaignId === campaignId);
      }
      if (callDate) {
        hits = hits.filter((h) => inDateRange(h.callDate, callDate, endDate || callDate));
      }
      if (phonebanker) {
        const canon = canonicalizePhonebankerName(phonebanker);
        hits = hits.filter((h) => canonicalizePhonebankerName(h.phonebankerName) === canon);
      }
      if (displayLabel) {
        hits = hits.filter((h) => synthesizedHitMatchesLabel(h, displayLabel, profile));
      }
      if (family) {
        hits = hits.filter((h) => finalResultFamilyForDisplayLabel(h.displayLabel) === family);
      }

      const total = hits.length;
      const truncated = total > MAX_HITS;
      return {
        hits: truncated ? hits.slice(0, MAX_HITS) : hits,
        truncated,
        total,
      };
    },
    { req, requireCredentials: { gcp: true } }
  );
}
