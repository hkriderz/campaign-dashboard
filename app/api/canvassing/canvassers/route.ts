import { NextResponse } from "next/server";
import {
  getPhonebankingTags,
  getTagById,
  isDerivedQcTagId,
  resolveSurveyScriptProfile,
} from "@/lib/campaign-tags";
import {
  CredentialsRequiredError,
  credentialsRequiredResponse,
  withCredentialContext,
} from "@/lib/credentials";
import {
  canvasserOverviewDateBounds,
  filterPairsByOptionalQcDate,
  selectCanvasserOverviewPairs,
  tallyCanvasserOverview,
  type CanvasserOverviewCandidate,
  type CanvasserOverviewPayload,
} from "@/lib/qc-recontact/canvasser-overview";
import { loadQcRecontactPairsForPage } from "@/lib/queries/qc-recontact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function candidateOptions(): CanvasserOverviewCandidate[] {
  return getPhonebankingTags()
    .filter((tag) => !isDerivedQcTagId(tag.id) && getTagById(`qc-${tag.id}`))
    .map((tag) => ({ id: tag.id, label: tag.label }));
}

function emptyPayload(candidates: CanvasserOverviewCandidate[]): CanvasserOverviewPayload {
  return {
    tagId: "",
    tagLabel: "",
    qcTagId: "",
    hasSnapshot: false,
    minDate: "",
    maxDate: "",
    candidates,
    canvassers: [],
  };
}

export const GET = withCredentialContext(async (req) => {
  try {
    const url = new URL(req.url);
    const tagId = url.searchParams.get("tagId")?.trim() ?? "";
    const startDate = url.searchParams.get("startDate")?.trim() ?? "";
    const endDate = url.searchParams.get("endDate")?.trim() ?? "";
    const candidates = candidateOptions();

    if (!tagId) {
      return NextResponse.json({ ok: true, data: emptyPayload(candidates) });
    }

    const primary = getTagById(tagId);
    const qcTagId = `qc-${tagId}`;
    const qcTag = getTagById(qcTagId);
    if (!primary || isDerivedQcTagId(tagId) || !qcTag) {
      return NextResponse.json(
        { ok: false, error: "Unknown candidate. Pick a candidate that has QC calls.", code: 400 },
        { status: 400 }
      );
    }

    const loaded = await loadQcRecontactPairsForPage(qcTagId);
    if (!loaded?.hasSnapshot) {
      return NextResponse.json({
        ok: true,
        data: {
          ...emptyPayload(candidates),
          tagId: primary.id,
          tagLabel: primary.label,
          qcTagId,
        },
      });
    }

    const profile = resolveSurveyScriptProfile(qcTag);
    const selected = selectCanvasserOverviewPairs(loaded.pairs, profile);
    const bounds = canvasserOverviewDateBounds(selected);
    const filtered = filterPairsByOptionalQcDate(selected, startDate, endDate);
    const tally = tallyCanvasserOverview(filtered, profile);

    const data: CanvasserOverviewPayload = {
      tagId: primary.id,
      tagLabel: primary.label,
      qcTagId,
      hasSnapshot: true,
      minDate: bounds.minDate,
      maxDate: bounds.maxDate,
      candidates,
      canvassers: tally.canvassers,
    };
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof CredentialsRequiredError) {
      return credentialsRequiredResponse(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[canvassing/canvassers GET]", message);
    return NextResponse.json({ ok: false, error: message, code: 500 }, { status: 500 });
  }
});
