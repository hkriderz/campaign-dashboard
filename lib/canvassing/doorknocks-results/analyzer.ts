import "server-only";

import {
  DEFAULT_DOORKNOCK_SUMMARY_SETTINGS,
  type DoorknockCampaignReport,
  type DoorknockResultsReport,
  type DoorknockResultsSummary,
  type DoorknockSummaryFlag,
  type DoorknockSummaryFlagKind,
  type DoorknockSummarySettings,
  type DoorknockSurveyGroup,
} from "./types";
import { answerMatches, canonical, flagCountThreshold, isHostileNonContactLabel, shortDispositionLabel } from "./helpers";
import { normalizeDoorknockSettings, parseDoorknockCsvReport } from "./parser";

type UploadFileInput = {
  fileName: string;
  relativePath?: string;
  buffer: Buffer;
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function flagBucket(): Record<DoorknockSummaryFlagKind, DoorknockSummaryFlag[]> {
  return {
    low_doors_low_support: [],
    low_contact_rate: [],
    survey_support_struggle: [],
    non_contact_outlier: [],
  };
}

function groupHasStrongSupport(group: DoorknockSurveyGroup): boolean {
  return group.columns.some((column) => answerMatches(column.answer, ["strong support"]));
}

/** First question that actually records Strong Support, skipping lit and household groups. */
function firstSurveyGroup(campaign: DoorknockCampaignReport) {
  return campaign.surveyGroups.find(groupHasStrongSupport) ?? null;
}

function selectedSurveyGroups(campaign: DoorknockCampaignReport, settings: DoorknockSummarySettings) {
  if (settings.surveyQuestionScope === "all") return campaign.surveyGroups;
  const first = firstSurveyGroup(campaign);
  return first ? [first] : [];
}

function countAnswers(
  campaign: DoorknockCampaignReport,
  row: DoorknockCampaignReport["rows"][number],
  labels: string[],
  scope: "first" | "all"
): number {
  const groups = scope === "all" ? campaign.surveyGroups : firstSurveyGroup(campaign) ? [firstSurveyGroup(campaign)!] : [];
  let total = 0;
  for (const group of groups) {
    for (const col of group.columns) {
      if (answerMatches(col.answer, labels)) total += row.surveyAnswers[col.key] ?? 0;
    }
  }
  return total;
}

function buildLowDoorsFlags(campaign: DoorknockCampaignReport, settings: DoorknockSummarySettings): DoorknockSummaryFlag[] {
  return campaign.rows
    .filter((row) => row.doorsKnocked < settings.lowDoorsThreshold)
    .map((row) => {
      const strongSupport = countAnswers(campaign, row, settings.strongSupportAnswerLabels, "first");
      return { row, strongSupport };
    })
    .filter(({ strongSupport }) => strongSupport < settings.lowDoorsMaxStrongSupport)
    .map(({ row, strongSupport }) => ({
      kind: "low_doors_low_support" as const,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      canvasserName: row.canvasserName,
      message: `${row.canvasserName} - ${row.doorsKnocked} knocks, ${row.contacts} contacts (${strongSupport} SS)`,
      metrics: {
        doorsKnocked: row.doorsKnocked,
        contacts: row.contacts,
        strongSupport,
      },
    }));
}

function buildLowContactFlags(campaign: DoorknockCampaignReport, settings: DoorknockSummarySettings): DoorknockSummaryFlag[] {
  const threshold = settings.lowContactRatePct / 100;
  return campaign.rows
    .filter((row) => row.doorsKnocked > 0 && row.contactRate < threshold)
    .map((row) => ({
      kind: "low_contact_rate" as const,
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      canvasserName: row.canvasserName,
      message: `${row.canvasserName} - ${row.doorsKnocked} knocks, ${row.contacts} contacts (${percent(row.contactRate)})`,
      metrics: {
        doorsKnocked: row.doorsKnocked,
        contacts: row.contacts,
        contactRatePct: row.contactRate * 100,
      },
    }));
}

export type DoorknockSummaryOptions = {
  /** Lean Support counts toward the struggle rate only on the first survey question. */
  leanSupportFirstQuestionOnly?: boolean;
};

function countsAsSupport(
  answer: string,
  settings: DoorknockSummarySettings,
  countLeanSupport: boolean
): boolean {
  if (!answerMatches(answer, settings.supportAnswerLabels)) return false;
  if (countLeanSupport) return true;
  return !answerMatches(answer, ["lean support"]);
}

function buildSurveyFlags(
  campaign: DoorknockCampaignReport,
  settings: DoorknockSummarySettings,
  options?: DoorknockSummaryOptions
): DoorknockSummaryFlag[] {
  const groups = selectedSurveyGroups(campaign, settings);
  const first = firstSurveyGroup(campaign);
  const threshold = settings.surveySupportThresholdPct / 100;
  const flags: DoorknockSummaryFlag[] = [];

  for (const row of campaign.rows) {
    if (row.contacts <= 0) continue;
    for (const group of groups) {
      const countLeanSupport = !options?.leanSupportFirstQuestionOnly || group === first;
      let support = 0;
      let strongSupport = 0;
      let undecided = 0;
      let answered = 0;
      for (const col of group.columns) {
        const value = row.surveyAnswers[col.key] ?? 0;
        answered += value;
        if (countsAsSupport(col.answer, settings, countLeanSupport)) support += value;
        if (answerMatches(col.answer, settings.strongSupportAnswerLabels)) strongSupport += value;
        if (answerMatches(col.answer, settings.undecidedAnswerLabels)) undecided += value;
      }

      const rate = support / row.contacts;
      if (rate >= threshold) continue;
      flags.push({
        kind: "survey_support_struggle",
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        canvasserName: row.canvasserName,
        message: `${row.canvasserName} - ${strongSupport} SS, ${undecided} U on ${campaign.campaignName} (${percent(rate)} support on "${group.question}")`,
        metrics: {
          strongSupport,
          support,
          undecided,
          contacts: row.contacts,
          answered,
          supportRatePct: rate * 100,
          question: group.question,
        },
      });
    }
  }

  return flags;
}

function buildNonContactFlags(campaign: DoorknockCampaignReport, settings: DoorknockSummarySettings): DoorknockSummaryFlag[] {
  const flags: DoorknockSummaryFlag[] = [];
  const ignored = settings.ignoredNonContactLabels.map(canonical);

  for (const col of campaign.nonContactColumns) {
    const label = canonical(col.label);
    if (ignored.some((needle) => label.includes(needle))) continue;

    const hostileColumn = isHostileNonContactLabel(col.label);
    const shortLabel = shortDispositionLabel(col.label);
    const values = campaign.rows.map((row) => row.nonContacts[col.key] ?? 0);
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const threshold = flagCountThreshold(col.label, settings.flagCountThresholds);

    for (const row of campaign.rows) {
      const value = row.nonContacts[col.key] ?? 0;
      if (value <= 0) continue;
      if (value < threshold) continue;
      flags.push({
        kind: "non_contact_outlier",
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        canvasserName: row.canvasserName,
        message: `${row.canvasserName} - ${value} ${shortLabel} (${campaign.campaignName})`,
        metrics: {
          value,
          column: shortLabel,
          sourceHeader: col.sourceHeader || col.label,
          average: Number(average.toFixed(2)),
          threshold,
          hostile: hostileColumn ? 1 : 0,
        },
      });
    }
  }

  return flags;
}

function detectOverallReportDate(campaigns: DoorknockCampaignReport[]): string | null {
  const counts = new Map<string, number>();
  for (const campaign of campaigns) {
    if (!campaign.reportDate) continue;
    counts.set(campaign.reportDate, (counts.get(campaign.reportDate) ?? 0) + 1);
  }
  let bestDate: string | null = null;
  let bestCount = 0;
  for (const [date, count] of counts.entries()) {
    if (count > bestCount) {
      bestDate = date;
      bestCount = count;
    }
  }
  return bestDate;
}

export function summarizeDoorknockCampaigns(
  campaigns: DoorknockCampaignReport[],
  settings: DoorknockSummarySettings,
  options?: DoorknockSummaryOptions
): DoorknockResultsSummary {
  const flags = flagBucket();
  for (const campaign of campaigns) {
    flags.low_doors_low_support.push(...buildLowDoorsFlags(campaign, settings));
    flags.low_contact_rate.push(...buildLowContactFlags(campaign, settings));
    flags.survey_support_struggle.push(...buildSurveyFlags(campaign, settings, options));
    flags.non_contact_outlier.push(...buildNonContactFlags(campaign, settings));
  }

  const totalDoorsKnocked = campaigns.reduce((sum, campaign) => sum + campaign.totals.doorsKnocked, 0);
  const totalContacts = campaigns.reduce((sum, campaign) => sum + campaign.totals.contacts, 0);

  return {
    reportDate: detectOverallReportDate(campaigns),
    campaignCount: campaigns.length,
    sourceFileCount: campaigns.length,
    totalCanvassers: campaigns.reduce((sum, campaign) => sum + campaign.rows.length, 0),
    totalDoorsKnocked,
    totalContacts,
    contactRate: totalDoorsKnocked ? totalContacts / totalDoorsKnocked : 0,
    flags,
  };
}

export async function analyzeDoorknockResultUploads(
  files: UploadFileInput[],
  rawSettings?: Partial<DoorknockSummarySettings> | null
): Promise<DoorknockResultsReport> {
  const settings = normalizeDoorknockSettings(rawSettings ?? DEFAULT_DOORKNOCK_SUMMARY_SETTINGS);
  const campaigns: DoorknockCampaignReport[] = [];
  const validationIssues: string[] = [];

  for (const file of files) {
    const parsed = parseDoorknockCsvReport(file);
    validationIssues.push(...parsed.issues);
    if (parsed.report) campaigns.push(parsed.report);
  }

  campaigns.sort((a, b) => a.campaignName.localeCompare(b.campaignName));

  return {
    sourceFiles: campaigns.map((campaign) => campaign.sourceFile),
    campaigns,
    settings,
    summary: summarizeDoorknockCampaigns(campaigns, settings),
    validationIssues,
  };
}
