import "server-only";

import { summarizeDoorknockCampaigns } from "@/lib/canvassing/doorknocks-results/analyzer";
import { normalizeDoorknockSettings } from "@/lib/canvassing/doorknocks-results/parser";
import type {
  DoorknockCampaignReport,
  DoorknockSummarySettings,
} from "@/lib/canvassing/doorknocks-results/types";
import { canonical } from "@/lib/canvassing/doorknocks-results/helpers";
import { parsePendingApprovalCsv } from "./parser";
import {
  DEFAULT_DATA_CHECKS_SETTINGS,
  type DataCheckFlag,
  type DataChecksReport,
  type DataChecksSummary,
} from "./types";

type UploadFileInput = {
  fileName: string;
  relativePath?: string;
  buffer: Buffer;
};

function failedCheck(value: string | undefined): boolean {
  if (value === undefined) return false;
  return canonical(value) !== "yes";
}

export function buildGeoTimingFlags(campaigns: DoorknockCampaignReport[]): DataCheckFlag[] {
  const flags: DataCheckFlag[] = [];
  for (const campaign of campaigns) {
    for (const row of campaign.rows) {
      const geoFailed = failedCheck(row.geoCheck);
      const timingFailed = failedCheck(row.timingCheck);
      if (!geoFailed && !timingFailed) continue;
      const parts: string[] = [];
      if (geoFailed) parts.push(`Geo ${row.geoCheck?.trim() || "blank"}`);
      if (timingFailed) parts.push(`Timing ${row.timingCheck?.trim() || "blank"}`);
      flags.push({
        kind: "geo_timing_check",
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        canvasserName: row.canvasserName,
        message: `${row.canvasserName} - ${parts.join(", ")} (${campaign.campaignName})`,
        metrics: {
          geoCheck: row.geoCheck ?? "",
          timingCheck: row.timingCheck ?? "",
        },
      });
    }
  }
  return flags;
}

export function normalizeDataChecksSettings(
  raw: Partial<DoorknockSummarySettings> | null | undefined
): DoorknockSummarySettings {
  const settings = normalizeDoorknockSettings(raw ?? DEFAULT_DATA_CHECKS_SETTINGS);
  if (!raw?.supportAnswerLabels?.length) {
    settings.supportAnswerLabels = [...DEFAULT_DATA_CHECKS_SETTINGS.supportAnswerLabels];
  }
  return settings;
}

export async function analyzePendingApprovalUploads(
  files: UploadFileInput[],
  rawSettings?: Partial<DoorknockSummarySettings> | null
): Promise<DataChecksReport> {
  const settings = normalizeDataChecksSettings(rawSettings);
  const campaigns: DoorknockCampaignReport[] = [];
  const validationIssues: string[] = [];

  for (const file of files) {
    const parsed = parsePendingApprovalCsv(file);
    validationIssues.push(...parsed.issues);
    if (parsed.report) campaigns.push(parsed.report);
  }

  campaigns.sort((a, b) => a.campaignName.localeCompare(b.campaignName));
  const summary = summarizeDoorknockCampaigns(campaigns, settings, { leanSupportFirstQuestionOnly: true });
  const dataSummary: DataChecksSummary = {
    ...summary,
    flags: {
      ...summary.flags,
      geo_timing_check: buildGeoTimingFlags(campaigns),
    },
  };

  return {
    sourceFiles: campaigns.map((campaign) => campaign.sourceFile),
    campaigns,
    settings,
    summary: dataSummary,
    validationIssues,
  };
}
