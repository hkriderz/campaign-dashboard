/**
 * Phonebanker QC Overview: same rollup as Canvasser QC Overview, grouped by the
 * phonebanker who originally ID'd the voter. Reads pairs already in memory.
 * Does not query BigQuery.
 */
import { escapeCsvCell } from "../pivot-csv-export";
import { canonicalizePhonebankerKey, canonicalizePhonebankerName } from "../phonebanker-name";
import type { SurveyScriptProfile } from "../types";
import { familyFromResultLabel } from "../unique-ids/classify";
import type { UniqueIdFamily } from "../unique-ids/types";
import { displayRecontactResultLabel } from "./labels";
import {
  isRecordedSupportLabel,
  pairIsUsefulRecontact,
  pairWithSupportAnswers,
  sortPriorsNewestFirst,
} from "./pair";
import type { PriorContactSummary, QcRecontactPair } from "./types";
import {
  classifyContactedAnswer,
  formatOverviewPercent,
  splitVoterName,
  type CanvasserFamilyBlock,
  type ContactedBucket,
} from "./canvasser-overview";

export type PhonebankerFamilyBlock = CanvasserFamilyBlock;

export type PhonebankerOverviewDetail = {
  phonebankerName: string;
  originalFlag: string;
  originalFlagFamily: UniqueIdFamily | null;
  originalFlagDate: string;
  pdiId: string;
  voterFirstName: string;
  voterLastName: string;
  address: string;
  contactedAnswer: string;
  contactedBucket: ContactedBucket | null;
  pollingLabel: string;
  pollingFamily: UniqueIdFamily | null;
  finalResultLabel: string;
  finalResultFamily: UniqueIdFamily | null;
  callerName: string;
  callDate: string;
  callTime: string;
};

export type PhonebankerOverviewRow = {
  phonebankerName: string;
  surveyed: number;
  originallyStrongSupport: number;
  recallContactRate: number | null;
  strongSupportOnPollingRate: number | null;
  strongSupportAfterPersuasionRate: number | null;
  contactedYes: number;
  contactedUnsure: number;
  contactedNo: number;
  originalStrongSupportPolling: PhonebankerFamilyBlock;
  originalStrongSupportFinal: PhonebankerFamilyBlock;
  originalUndecidedFinal: PhonebankerFamilyBlock;
  details: PhonebankerOverviewDetail[];
};

export type PhonebankerOverviewTally = {
  phonebankers: PhonebankerOverviewRow[];
};

export type PhonebankerOverviewCandidate = {
  id: string;
  label: string;
};

export type PhonebankerOverviewPayload = {
  tagId: string;
  tagLabel: string;
  qcTagId: string;
  hasSnapshot: boolean;
  minDate: string;
  maxDate: string;
  candidates: PhonebankerOverviewCandidate[];
  phonebankers: PhonebankerOverviewRow[];
};

const SUMMARY_GROUP_HEADERS = [
  "Phonebanker",
  "Surveyed",
  "Originally strong support",
  "Recall contact %",
  "Strong support on polling %",
  "Strong support after persuasion %",
  "Contacted",
  "",
  "",
  "Originally strong support — polling",
  "",
  "",
  "",
  "Originally strong support — final result",
  "",
  "",
  "",
  "Originally undecided — final result",
  "",
  "",
  "",
] as const;

const FAMILY_HEADERS = ["Surveyed", "Strong support", "Undecided", "Strong oppose"] as const;

const SUMMARY_COLUMN_HEADERS = [
  "",
  "",
  "",
  "",
  "",
  "",
  "Yes",
  "Unsure",
  "No",
  ...FAMILY_HEADERS,
  ...FAMILY_HEADERS,
  ...FAMILY_HEADERS,
] as const;

export const PHONEBANKER_OVERVIEW_DETAIL_HEADERS = [
  "Phoned by?",
  "Original Flag",
  "Original Flag Date",
  "PDI ID",
  "Voter First Name",
  "Voter Last Name",
  "Address",
  "1. Were you contacted?",
  "2. Polling",
  "4. Final Result",
  "Caller Name",
  "Call Date Adjusted",
  "Call Time",
] as const;

function emptyFamilyBlock(): PhonebankerFamilyBlock {
  return { surveyed: 0, strongSupport: 0, undecided: 0, strongOppose: 0 };
}

function rate(part: number, whole: number): number | null {
  if (!whole) return null;
  return part / whole;
}

function addFamilyBlocks(left: PhonebankerFamilyBlock, right: PhonebankerFamilyBlock): PhonebankerFamilyBlock {
  return {
    surveyed: left.surveyed + right.surveyed,
    strongSupport: left.strongSupport + right.strongSupport,
    undecided: left.undecided + right.undecided,
    strongOppose: left.strongOppose + right.strongOppose,
  };
}

export function summarizePhonebankerOverview(
  rows: readonly PhonebankerOverviewRow[]
): PhonebankerOverviewRow | null {
  if (!rows.length) return null;
  const surveyed = rows.reduce((sum, row) => sum + row.surveyed, 0);
  const originallyStrongSupport = rows.reduce((sum, row) => sum + row.originallyStrongSupport, 0);
  const contactedYes = rows.reduce((sum, row) => sum + row.contactedYes, 0);
  const contactedUnsure = rows.reduce((sum, row) => sum + row.contactedUnsure, 0);
  const contactedNo = rows.reduce((sum, row) => sum + row.contactedNo, 0);
  const originalStrongSupportPolling = rows.reduce(
    (sum, row) => addFamilyBlocks(sum, row.originalStrongSupportPolling),
    emptyFamilyBlock()
  );
  const originalStrongSupportFinal = rows.reduce(
    (sum, row) => addFamilyBlocks(sum, row.originalStrongSupportFinal),
    emptyFamilyBlock()
  );
  const originalUndecidedFinal = rows.reduce(
    (sum, row) => addFamilyBlocks(sum, row.originalUndecidedFinal),
    emptyFamilyBlock()
  );
  return {
    phonebankerName: "Total",
    surveyed,
    originallyStrongSupport,
    recallContactRate: rate(contactedYes, surveyed),
    strongSupportOnPollingRate: rate(originalStrongSupportPolling.strongSupport, originallyStrongSupport),
    strongSupportAfterPersuasionRate: rate(originalStrongSupportFinal.strongSupport, originallyStrongSupport),
    contactedYes,
    contactedUnsure,
    contactedNo,
    originalStrongSupportPolling,
    originalStrongSupportFinal,
    originalUndecidedFinal,
    details: [],
  };
}

function addFamily(block: PhonebankerFamilyBlock, family: UniqueIdFamily | null): void {
  block.surveyed += 1;
  if (family === "strongSupport") block.strongSupport += 1;
  else if (family === "undecided") block.undecided += 1;
  else if (family === "strongOppose") block.strongOppose += 1;
}

function callTimeFromIso(callAt: string): string {
  const stamp = callAt.trim();
  if (!stamp) return "";
  const time = stamp.includes("T") ? stamp.slice(stamp.indexOf("T") + 1) : stamp;
  return time.replace(/Z$/i, "").replace(/\.\d+$/, "").slice(0, 8);
}

/** Newest phone-bank prior with a name and a result. Canvass and text do not qualify. */
export function latestPhonebankPrior(pair: QcRecontactPair): PriorContactSummary | null {
  const priors = pair.priors.filter(
    (prior) => prior.channel === "phonebank" && prior.actorName.trim() && prior.resultLabel.trim()
  );
  return sortPriorsNewestFirst(priors)[0] ?? null;
}

/**
 * Useful QC recontacts that still have a phonebank prior after support-only filtering.
 * Canvass and text actors do not create a phonebanker row.
 */
export function selectPhonebankerOverviewPairs(
  pairs: readonly QcRecontactPair[],
  profile: SurveyScriptProfile = "faizahTraci"
): QcRecontactPair[] {
  return pairs
    .filter((pair) => pairIsUsefulRecontact(pair, profile))
    .map((pair) => pairWithSupportAnswers(pair, profile))
    .filter((pair) => {
      const prior = latestPhonebankPrior(pair);
      return Boolean(prior && isRecordedSupportLabel(prior.resultLabel, profile));
    });
}

function detailFromPair(
  pair: QcRecontactPair,
  prior: PriorContactSummary,
  profile: SurveyScriptProfile
): PhonebankerOverviewDetail | null {
  const phonebankerName = canonicalizePhonebankerName(prior.actorName);
  if (!phonebankerName) return null;
  const voter = splitVoterName(pair.qc.voterName ?? "");
  const contactedAnswer = pair.qc.contactedAnswer ?? "";
  return {
    phonebankerName,
    originalFlag: displayRecontactResultLabel(prior.resultLabel, profile),
    originalFlagFamily: familyFromResultLabel(prior.resultLabel, profile),
    originalFlagDate: prior.occurredOn,
    pdiId: pair.qc.pdiId,
    voterFirstName: voter.first,
    voterLastName: voter.last,
    address: pair.qc.voterAddress ?? "",
    contactedAnswer,
    contactedBucket: classifyContactedAnswer(contactedAnswer),
    pollingLabel: displayRecontactResultLabel(pair.qc.pollingLabel, profile),
    pollingFamily: familyFromResultLabel(pair.qc.pollingLabel, profile),
    finalResultLabel: displayRecontactResultLabel(pair.qc.finalResultLabel, profile),
    finalResultFamily: familyFromResultLabel(pair.qc.finalResultLabel, profile),
    callerName: pair.qc.phonebankerName,
    callDate: pair.qc.callDate,
    callTime: callTimeFromIso(pair.qc.callAt),
  };
}

export function tallyPhonebankerOverview(
  pairs: readonly QcRecontactPair[],
  profile: SurveyScriptProfile = "faizahTraci"
): PhonebankerOverviewTally {
  const byKey = new Map<string, PhonebankerOverviewDetail[]>();

  for (const pair of selectPhonebankerOverviewPairs(pairs, profile)) {
    const prior = latestPhonebankPrior(pair);
    if (!prior || !isRecordedSupportLabel(prior.resultLabel, profile)) continue;
    const detail = detailFromPair(pair, prior, profile);
    if (!detail) continue;
    const key = canonicalizePhonebankerKey(prior.actorName);
    const list = byKey.get(key) ?? [];
    list.push(detail);
    byKey.set(key, list);
  }

  const phonebankers: PhonebankerOverviewRow[] = [...byKey.values()].map((details) => {
    const sorted = [...details].sort((a, b) => {
      const byDate = a.callDate.localeCompare(b.callDate);
      if (byDate !== 0) return byDate;
      const byTime = a.callTime.localeCompare(b.callTime);
      if (byTime !== 0) return byTime;
      return a.pdiId.localeCompare(b.pdiId);
    });

    const originalStrongSupportPolling = emptyFamilyBlock();
    const originalStrongSupportFinal = emptyFamilyBlock();
    const originalUndecidedFinal = emptyFamilyBlock();
    let originallyStrongSupport = 0;
    let contactedYes = 0;
    let contactedUnsure = 0;
    let contactedNo = 0;

    for (const detail of sorted) {
      if (detail.contactedBucket === "yes") contactedYes += 1;
      else if (detail.contactedBucket === "unsure") contactedUnsure += 1;
      else if (detail.contactedBucket === "no") contactedNo += 1;

      if (detail.originalFlagFamily === "strongSupport") {
        originallyStrongSupport += 1;
        addFamily(originalStrongSupportPolling, detail.pollingFamily);
        addFamily(originalStrongSupportFinal, detail.finalResultFamily);
      } else if (detail.originalFlagFamily === "undecided") {
        addFamily(originalUndecidedFinal, detail.finalResultFamily);
      }
    }

    const surveyed = sorted.length;
    return {
      phonebankerName: sorted[0]?.phonebankerName ?? "",
      surveyed,
      originallyStrongSupport,
      recallContactRate: rate(contactedYes, surveyed),
      strongSupportOnPollingRate: rate(originalStrongSupportPolling.strongSupport, originallyStrongSupport),
      strongSupportAfterPersuasionRate: rate(originalStrongSupportFinal.strongSupport, originallyStrongSupport),
      contactedYes,
      contactedUnsure,
      contactedNo,
      originalStrongSupportPolling,
      originalStrongSupportFinal,
      originalUndecidedFinal,
      details: sorted,
    };
  });

  phonebankers.sort(
    (a, b) => b.surveyed - a.surveyed || a.phonebankerName.localeCompare(b.phonebankerName)
  );

  return { phonebankers };
}

function familyCells(block: PhonebankerFamilyBlock): Array<string | number> {
  return [block.surveyed, block.strongSupport, block.undecided, block.strongOppose];
}

function summaryDataRow(row: PhonebankerOverviewRow): Array<string | number> {
  return [
    row.phonebankerName,
    row.surveyed,
    row.originallyStrongSupport,
    formatOverviewPercent(row.recallContactRate),
    formatOverviewPercent(row.strongSupportOnPollingRate),
    formatOverviewPercent(row.strongSupportAfterPersuasionRate),
    row.contactedYes,
    row.contactedUnsure,
    row.contactedNo,
    ...familyCells(row.originalStrongSupportPolling),
    ...familyCells(row.originalStrongSupportFinal),
    ...familyCells(row.originalUndecidedFinal),
  ];
}

function detailDataRow(detail: PhonebankerOverviewDetail): Array<string | number> {
  return [
    detail.phonebankerName,
    detail.originalFlag,
    detail.originalFlagDate,
    detail.pdiId,
    detail.voterFirstName,
    detail.voterLastName,
    detail.address,
    detail.contactedAnswer,
    detail.pollingLabel,
    detail.finalResultLabel,
    detail.callerName,
    detail.callDate,
    detail.callTime,
  ];
}

function csvLine(values: readonly (string | number)[]): string {
  return values.map((value) => escapeCsvCell(value)).join(",");
}

export function buildPhonebankerOverviewCsv(tally: PhonebankerOverviewTally): string {
  const totals = summarizePhonebankerOverview(tally.phonebankers);
  const summaryRows = totals ? [totals, ...tally.phonebankers] : [...tally.phonebankers];
  const lines = [
    csvLine(SUMMARY_GROUP_HEADERS),
    csvLine(SUMMARY_COLUMN_HEADERS),
    ...summaryRows.map((row) => csvLine(summaryDataRow(row))),
    "",
    csvLine(PHONEBANKER_OVERVIEW_DETAIL_HEADERS),
    ...tally.phonebankers.flatMap((row) => row.details.map((detail) => csvLine(detailDataRow(detail)))),
  ];
  return lines.join("\r\n");
}

export function phonebankerOverviewExportFilename(tagId: string, startDate: string, endDate: string): string {
  const slug = tagId.replace(/[^a-z0-9_-]/gi, "") || "candidate";
  const start = startDate.trim();
  const end = endDate.trim();
  const range = start && end ? (start === end ? start : `${start}_to_${end}`) : "all";
  return `phonebanker-overview-${slug}-${range}.csv`;
}
