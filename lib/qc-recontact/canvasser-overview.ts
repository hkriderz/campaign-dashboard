/**
 * Canvasser Overview: QC recontacts rolled up by the canvasser who originally ID'd the voter.
 * Definitions are locked to the Detailed Canvasser View sheet (Dilan Davila sample).
 */
import { assignmentCampaignPrefix } from "../canvassing/data-checks/parser";
import { canvasserIdentityKey, preferredCanvasserName } from "../canvassing/display-names";
import { escapeCsvCell } from "../pivot-csv-export";
import type { SurveyScriptProfile } from "../types";
import { familyFromResultLabel } from "../unique-ids/classify";
import type { UniqueIdFamily } from "../unique-ids/types";
import { displayRecontactResultLabel } from "./labels";
import {
  ALL_OVERVIEW_DETAIL_COLUMN_IDS,
  overviewDetailHeadersForColumns,
  overviewDetailValuesForColumns,
  type OverviewDetailColumnId,
} from "./overview-detail-columns";
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
  notesAnswer: string;
  contactedBucket: ContactedBucket | null;
  pollingLabel: string;
  pollingFamily: UniqueIdFamily | null;
  finalResultLabel: string;
  finalResultFamily: UniqueIdFamily | null;
  callerName: string;
  callDate: string;
  callTime: string;
  /** Canvass assignment the latest prior came from. The project filter groups this by project, not turf. */
  sourceList: string;
  /** QC campaign name. Used by the QC phone-bank filter, not a table column. */
  qcCampaignName: string;
};

export type CanvasserOverviewRow = {
  /** Stable expand/key id (identity key of the original canvasser). */
  rowId: string;
  canvasserName: string;
  surveyed: number;
  originallyStrongSupport: number;
  /** Null when surveyed is 0. A real 0 means nobody answered Yes. */
  recallContactRate: number | null;
  /** Null when nobody was originally strong support. */
  strongSupportOnPollingRate: number | null;
  /** Null when nobody was originally strong support. */
  strongSupportAfterPersuasionRate: number | null;
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

export const CANVASSER_OVERVIEW_DETAIL_HEADERS = overviewDetailHeadersForColumns(
  ALL_OVERVIEW_DETAIL_COLUMN_IDS,
  "canvasser"
);

function emptyFamilyBlock(): CanvasserFamilyBlock {
  return { surveyed: 0, strongSupport: 0, undecided: 0, strongOppose: 0 };
}

function rate(part: number, whole: number): number | null {
  if (!whole) return null;
  return part / whole;
}

/**
 * Share of Yes among people who answered “Were you contacted?”.
 * Null when nobody answered (show N/A). Banks with no contacted question do not
 * dilute the rate — they are omitted from the denominator.
 */
export function recallContactRateFromCounts(
  contactedYes: number,
  contactedUnsure: number,
  contactedNo: number
): number | null {
  const answered = contactedYes + contactedUnsure + contactedNo;
  if (answered === 0) return null;
  return rate(contactedYes, answered);
}

/**
 * Strong-support share on polling among originally-SS people.
 * Null when none of those people have a classifiable polling answer (show N/A, not 0%).
 */
export function strongSupportOnPollingRateFromCounts(
  polling: Pick<CanvasserFamilyBlock, "strongSupport" | "undecided" | "strongOppose">,
  originallyStrongSupport: number
): number | null {
  if (!originallyStrongSupport) return null;
  if (polling.strongSupport + polling.undecided + polling.strongOppose === 0) return null;
  return rate(polling.strongSupport, originallyStrongSupport);
}

export function formatOverviewPercent(rateValue: number | null): string {
  if (rateValue === null || !Number.isFinite(rateValue)) return "N/A";
  return `${(rateValue * 100).toFixed(2)}%`;
}

export type OverviewPercentBand = "darkWarm" | "lightWarm" | "none" | "lightGreen" | "darkGreen";

/**
 * 0–20 dark orange/red, 21–40 light orange/red, 41–60 none, 61–80 light green, 81–100 dark green.
 * The lower edge of each band is inclusive.
 */
export function overviewPercentBand(rateValue: number | null): OverviewPercentBand | null {
  if (rateValue === null || !Number.isFinite(rateValue)) return null;
  const hundredths = Math.round(rateValue * 10000);
  if (hundredths <= 2000) return "darkWarm";
  if (hundredths <= 4000) return "lightWarm";
  if (hundredths <= 6000) return "none";
  if (hundredths <= 8000) return "lightGreen";
  return "darkGreen";
}

export function overviewPercentBandClass(rateValue: number | null): string {
  switch (overviewPercentBand(rateValue)) {
    case "darkWarm":
      return "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-50";
    case "lightWarm":
      return "bg-orange-100 text-orange-950 dark:bg-orange-900/35 dark:text-orange-50";
    case "lightGreen":
      return "bg-green-100 text-green-950 dark:bg-green-900/35 dark:text-green-50";
    case "darkGreen":
      return "bg-green-300 text-green-950 dark:bg-green-800/55 dark:text-green-50";
    default:
      return "";
  }
}

function addFamilyBlocks(left: CanvasserFamilyBlock, right: CanvasserFamilyBlock): CanvasserFamilyBlock {
  return {
    surveyed: left.surveyed + right.surveyed,
    strongSupport: left.strongSupport + right.strongSupport,
    undecided: left.undecided + right.undecided,
    strongOppose: left.strongOppose + right.strongOppose,
  };
}

/**
 * Counts are sums. Percentages use those sums, so a 100% row and a 0% row do not average to 50%
 * when the rows surveyed different numbers of people.
 */
export function summarizeCanvasserOverview(rows: readonly CanvasserOverviewRow[]): CanvasserOverviewRow | null {
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
    rowId: "total",
    canvasserName: "Total",
    surveyed,
    originallyStrongSupport,
    recallContactRate: recallContactRateFromCounts(contactedYes, contactedUnsure, contactedNo),
    strongSupportOnPollingRate: strongSupportOnPollingRateFromCounts(
      originalStrongSupportPolling,
      originallyStrongSupport
    ),
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
    notesAnswer: pair.qc.notesAnswer ?? "",
    contactedBucket: classifyContactedAnswer(contactedAnswer),
    pollingLabel: displayRecontactResultLabel(pair.qc.pollingLabel, profile),
    pollingFamily: familyFromResultLabel(pair.qc.pollingLabel, profile),
    finalResultLabel: displayRecontactResultLabel(pair.qc.finalResultLabel, profile),
    finalResultFamily: familyFromResultLabel(pair.qc.finalResultLabel, profile),
    callerName: pair.qc.phonebankerName,
    callDate: pair.qc.callDate,
    callTime: callTimeFromIso(pair.qc.callAt),
    sourceList: prior.listOrAssignment.trim(),
    qcCampaignName: pair.qc.campaignName.trim(),
  };
}

/** Project label for a canvass assignment, dropping a trailing turf or precinct id. */
export function canvasserProjectName(sourceList: string): string {
  return assignmentCampaignPrefix(sourceList);
}

export function canvasserProjectOptions(rows: readonly CanvasserOverviewRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const detail of row.details) {
      const name = canvasserProjectName(detail.sourceList);
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function canvasserQcPhonebankOptions(rows: readonly CanvasserOverviewRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const detail of row.details) {
      const name = detail.qcCampaignName.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function canvasserOverviewRowFromDetails(
  canvasserName: string,
  details: readonly CanvasserOverviewDetail[],
  rowId = canvasserIdentityKey(canvasserName) || canvasserName.toLowerCase() || canvasserName
): CanvasserOverviewRow {
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
  const displayName =
    preferredCanvasserName(sorted.map((detail) => detail.canvasserName)) || canvasserName;
  return {
    rowId: rowId || displayName,
    canvasserName: displayName,
    surveyed,
    originallyStrongSupport,
    recallContactRate: recallContactRateFromCounts(contactedYes, contactedUnsure, contactedNo),
    strongSupportOnPollingRate: strongSupportOnPollingRateFromCounts(
      originalStrongSupportPolling,
      originallyStrongSupport
    ),
    strongSupportAfterPersuasionRate: rate(originalStrongSupportFinal.strongSupport, originallyStrongSupport),
    contactedYes,
    contactedUnsure,
    contactedNo,
    originalStrongSupportPolling,
    originalStrongSupportFinal,
    originalUndecidedFinal,
    details: sorted,
  };
}

function filterCanvasserRows(
  rows: readonly CanvasserOverviewRow[],
  selected: readonly string[],
  matches: (detail: CanvasserOverviewDetail, wanted: Set<string>) => boolean
): readonly CanvasserOverviewRow[] {
  const wanted = new Set(selected.map((name) => name.trim()).filter(Boolean));
  if (wanted.size === 0) return rows;
  const next: CanvasserOverviewRow[] = [];
  for (const row of rows) {
    const details = row.details.filter((detail) => matches(detail, wanted));
    if (!details.length) continue;
    next.push(canvasserOverviewRowFromDetails(row.canvasserName, details, row.rowId));
  }
  next.sort((a, b) => b.surveyed - a.surveyed || a.canvasserName.localeCompare(b.canvasserName));
  return next;
}

/** Keep voter rows whose canvass project is checked. An empty list leaves the rows unchanged. */
export function filterCanvasserOverviewByProjects(
  rows: readonly CanvasserOverviewRow[],
  projects: readonly string[]
): readonly CanvasserOverviewRow[] {
  return filterCanvasserRows(rows, projects, (detail, wanted) =>
    wanted.has(canvasserProjectName(detail.sourceList))
  );
}

/** Keep voter rows whose QC phone bank is checked. An empty list leaves the rows unchanged. */
export function filterCanvasserOverviewByQcPhonebanks(
  rows: readonly CanvasserOverviewRow[],
  phonebanks: readonly string[]
): readonly CanvasserOverviewRow[] {
  return filterCanvasserRows(rows, phonebanks, (detail, wanted) =>
    wanted.has(detail.qcCampaignName.trim())
  );
}

export function tallyCanvasserOverview(
  pairs: readonly QcRecontactPair[],
  profile: SurveyScriptProfile = "faizahTraci"
): CanvasserOverviewTally {
  const byKey = new Map<string, CanvasserOverviewDetail[]>();

  for (const pair of selectCanvasserOverviewPairs(pairs, profile)) {
    const prior = latestCanvassPrior(pair);
    if (!prior || !isRecordedSupportLabel(prior.resultLabel, profile)) continue;
    const detail = detailFromPair(pair, prior, profile);
    const key =
      canvasserIdentityKey(detail.canvasserName) || detail.canvasserName.trim().toLowerCase();
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(detail);
    byKey.set(key, list);
  }

  const canvassers: CanvasserOverviewRow[] = [...byKey.entries()].map(([rowId, details]) =>
    canvasserOverviewRowFromDetails(
      preferredCanvasserName(details.map((detail) => detail.canvasserName)) || details[0]!.canvasserName,
      details,
      rowId
    )
  );

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

function detailDataRow(
  detail: CanvasserOverviewDetail,
  columnIds: readonly OverviewDetailColumnId[] = ALL_OVERVIEW_DETAIL_COLUMN_IDS
): Array<string | number> {
  return overviewDetailValuesForColumns(detail, columnIds);
}

function csvLine(values: readonly (string | number)[]): string {
  return values.map((value) => escapeCsvCell(value)).join(",");
}

/** Summary rows only (including Total), for clipboard paste into a spreadsheet. */
export function buildCanvasserOverviewSummaryTsv(rows: readonly CanvasserOverviewRow[]): string {
  const totals = summarizeCanvasserOverview(rows);
  const summaryRows = totals ? [totals, ...rows] : [...rows];
  const lines = [
    SUMMARY_GROUP_HEADERS.join("\t"),
    SUMMARY_COLUMN_HEADERS.join("\t"),
    ...summaryRows.map((row) => summaryDataRow(row).join("\t")),
  ];
  return `${lines.join("\n")}\n`;
}

/** Summary block, then every canvasser’s voter rows. Detail columns follow `visibleDetailColumnIds`. */
export function buildCanvasserOverviewCsv(
  tally: CanvasserOverviewTally,
  visibleDetailColumnIds: readonly OverviewDetailColumnId[] = ALL_OVERVIEW_DETAIL_COLUMN_IDS
): string {
  const detailIds =
    visibleDetailColumnIds.length > 0 ? visibleDetailColumnIds : ALL_OVERVIEW_DETAIL_COLUMN_IDS;
  const totals = summarizeCanvasserOverview(tally.canvassers);
  const summaryRows = totals ? [totals, ...tally.canvassers] : [...tally.canvassers];
  const lines = [
    csvLine(SUMMARY_GROUP_HEADERS),
    csvLine(SUMMARY_COLUMN_HEADERS),
    ...summaryRows.map((row) => csvLine(summaryDataRow(row))),
    "",
    csvLine(overviewDetailHeadersForColumns(detailIds, "canvasser")),
    ...tally.canvassers.flatMap((row) =>
      row.details.map((detail) => csvLine(detailDataRow(detail, detailIds)))
    ),
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
