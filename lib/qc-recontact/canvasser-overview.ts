/**
 * Canvasser Overview: QC recontacts rolled up by the canvasser who originally ID'd the voter.
 * Definitions are locked to the Detailed Canvasser View sheet (Dilan Davila sample).
 */
import { escapeCsvCell } from "../pivot-csv-export";
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

export type ContactedBucket = "yes" | "unsure" | "no";

export type CanvasserFamilyBlock = {
  surveyed: number;
  strongSupport: number;
  undecided: number;
  strongOppose: number;
};

export type CanvasserOverviewDetail = {
  canvasserName: string;
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

export type CanvasserOverviewRow = {
  canvasserName: string;
  surveyed: number;
  originallyStrongSupport: number;
  recallContactRate: number;
  strongSupportOnPollingRate: number;
  strongSupportAfterPersuasionRate: number;
  contactedYes: number;
  contactedUnsure: number;
  contactedNo: number;
  originalStrongSupportPolling: CanvasserFamilyBlock;
  originalStrongSupportFinal: CanvasserFamilyBlock;
  originalUndecidedFinal: CanvasserFamilyBlock;
  details: CanvasserOverviewDetail[];
};

export type CanvasserOverviewTally = {
  canvassers: CanvasserOverviewRow[];
};

export type CanvasserOverviewCandidate = {
  id: string;
  label: string;
};

export type CanvasserOverviewPayload = {
  tagId: string;
  tagLabel: string;
  qcTagId: string;
  hasSnapshot: boolean;
  minDate: string;
  maxDate: string;
  candidates: CanvasserOverviewCandidate[];
  canvassers: CanvasserOverviewRow[];
};

const SUMMARY_GROUP_HEADERS = [
  "Canvasser",
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

export const CANVASSER_OVERVIEW_DETAIL_HEADERS = [
  "Canvassed by?",
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

function emptyFamilyBlock(): CanvasserFamilyBlock {
  return { surveyed: 0, strongSupport: 0, undecided: 0, strongOppose: 0 };
}

function rate(part: number, whole: number): number {
  if (!whole) return 0;
  return part / whole;
}

export function formatOverviewPercent(rateValue: number): string {
  if (!Number.isFinite(rateValue)) return "0.00%";
  return `${(rateValue * 100).toFixed(2)}%`;
}

/** Yes / Unsure / No from a raw “Were you contacted?” answer (`A. Yes`, `B. Unsure`). */
export function classifyContactedAnswer(raw: string): ContactedBucket | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "[no answer recorded]") return null;
  const stripped = trimmed.replace(/^[0-9A-Za-z][.)\-:\s]+/, "").trim() || trimmed;
  const text = stripped.toLowerCase();
  if (/^(yes|y|sí|si)\b/u.test(text)) return "yes";
  if (/\b(unsure|not sure|no seguro|inseguro)\b/u.test(text)) return "unsure";
  if (/^(no|n)\b/u.test(text)) return "no";
  return null;
}

export function splitVoterName(name: string): { first: string; last: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return { first: "", last: "" };
  const space = trimmed.indexOf(" ");
  if (space === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, space), last: trimmed.slice(space + 1).trim() };
}

export function callTimeFromIso(callAt: string): string {
  const stamp = callAt.trim();
  if (!stamp) return "";
  const time = stamp.includes("T") ? stamp.slice(stamp.indexOf("T") + 1) : stamp;
  return time.replace(/Z$/i, "").replace(/\.\d+$/, "").slice(0, 8);
}

function addFamily(block: CanvasserFamilyBlock, family: UniqueIdFamily | null): void {
  block.surveyed += 1;
  if (family === "strongSupport") block.strongSupport += 1;
  else if (family === "undecided") block.undecided += 1;
  else if (family === "strongOppose") block.strongOppose += 1;
}

function latestCanvassPrior(pair: QcRecontactPair): PriorContactSummary | null {
  const priors = pair.priors.filter(
    (prior) => prior.channel === "canvass" && prior.actorName.trim() && prior.resultLabel.trim()
  );
  return sortPriorsNewestFirst(priors)[0] ?? null;
}

/**
 * Useful QC recontacts that still have a canvass prior after support-only filtering.
 * Phone and text actors do not create a canvasser row.
 */
export function selectCanvasserOverviewPairs(
  pairs: readonly QcRecontactPair[],
  profile: SurveyScriptProfile = "faizahTraci"
): QcRecontactPair[] {
  return pairs
    .filter((pair) => pairIsUsefulRecontact(pair, profile))
    .map((pair) => pairWithSupportAnswers(pair, profile))
    .filter((pair) => {
      const prior = latestCanvassPrior(pair);
      return Boolean(prior && isRecordedSupportLabel(prior.resultLabel, profile));
    });
}

export function filterPairsByOptionalQcDate(
  pairs: readonly QcRecontactPair[],
  startDate: string,
  endDate: string
): QcRecontactPair[] {
  const start = startDate.trim();
  const end = endDate.trim();
  if (!start && !end) return [...pairs];
  return pairs.filter((pair) => {
    const day = pair.qc.callDate;
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  });
}

export function canvasserOverviewDateBounds(pairs: readonly QcRecontactPair[]): {
  minDate: string;
  maxDate: string;
} {
  const dates = pairs.map((pair) => pair.qc.callDate).filter(Boolean).sort();
  return { minDate: dates[0] ?? "", maxDate: dates[dates.length - 1] ?? "" };
}

function detailFromPair(
  pair: QcRecontactPair,
  prior: PriorContactSummary,
  profile: SurveyScriptProfile
): CanvasserOverviewDetail {
  const voter = splitVoterName(pair.qc.voterName ?? "");
  const contactedAnswer = pair.qc.contactedAnswer ?? "";
  return {
    canvasserName: prior.actorName.trim(),
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

export function tallyCanvasserOverview(
  pairs: readonly QcRecontactPair[],
  profile: SurveyScriptProfile = "faizahTraci"
): CanvasserOverviewTally {
  const byName = new Map<string, CanvasserOverviewDetail[]>();

  for (const pair of selectCanvasserOverviewPairs(pairs, profile)) {
    const prior = latestCanvassPrior(pair);
    if (!prior || !isRecordedSupportLabel(prior.resultLabel, profile)) continue;
    const detail = detailFromPair(pair, prior, profile);
    const list = byName.get(detail.canvasserName) ?? [];
    list.push(detail);
    byName.set(detail.canvasserName, list);
  }

  const canvassers: CanvasserOverviewRow[] = [...byName.entries()].map(([canvasserName, details]) => {
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
      canvasserName,
      surveyed,
      originallyStrongSupport,
      recallContactRate: rate(contactedYes, surveyed),
      strongSupportOnPollingRate: rate(
        originalStrongSupportPolling.strongSupport,
        originallyStrongSupport
      ),
      strongSupportAfterPersuasionRate: rate(
        originalStrongSupportFinal.strongSupport,
        originallyStrongSupport
      ),
      contactedYes,
      contactedUnsure,
      contactedNo,
      originalStrongSupportPolling,
      originalStrongSupportFinal,
      originalUndecidedFinal,
      details: sorted,
    };
  });

  canvassers.sort(
    (a, b) => b.surveyed - a.surveyed || a.canvasserName.localeCompare(b.canvasserName)
  );

  return { canvassers };
}

function familyCells(block: CanvasserFamilyBlock): Array<string | number> {
  return [block.surveyed, block.strongSupport, block.undecided, block.strongOppose];
}

function summaryDataRow(row: CanvasserOverviewRow): Array<string | number> {
  return [
    row.canvasserName,
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

function detailDataRow(detail: CanvasserOverviewDetail): Array<string | number> {
  return [
    detail.canvasserName,
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

/** Summary block, then every canvasser’s voter rows, in the sheet’s column order. */
export function buildCanvasserOverviewCsv(tally: CanvasserOverviewTally): string {
  const lines = [
    csvLine(SUMMARY_GROUP_HEADERS),
    csvLine(SUMMARY_COLUMN_HEADERS),
    ...tally.canvassers.map((row) => csvLine(summaryDataRow(row))),
    "",
    csvLine(CANVASSER_OVERVIEW_DETAIL_HEADERS),
    ...tally.canvassers.flatMap((row) => row.details.map((detail) => csvLine(detailDataRow(detail)))),
  ];
  return lines.join("\r\n");
}

export function canvasserOverviewExportFilename(tagId: string, startDate: string, endDate: string): string {
  const slug = tagId.replace(/[^a-z0-9_-]/gi, "") || "candidate";
  const start = startDate.trim();
  const end = endDate.trim();
  const range = start && end ? (start === end ? start : `${start}_to_${end}`) : "all";
  return `canvasser-overview-${slug}-${range}.csv`;
}
