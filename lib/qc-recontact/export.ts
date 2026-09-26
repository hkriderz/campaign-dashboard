import { escapeCsvCell } from "../pivot-csv-export";
import type { SurveyScriptProfile } from "../types";
import { displayRecontactResultLabel } from "./labels";
import { changeKindLabel, firstClassifiablePrior, recontactChannelLabel } from "./pair";
import type { PriorContactSummary, QcRecontactPair } from "./types";

export const RECONTACT_CSV_HEADERS = [
  "Change",
  "Match status",
  "PDI",
  "Voter name",
  "Voter address",
  "Were you contacted",
  "QC date",
  "QC time",
  "QC list",
  "QC campaign ID",
  "QC caller",
  "QC call ID",
  "QC final result",
  "QC polling",
  "QC canvass result",
  "Prior channel",
  "Prior date",
  "Prior time",
  "Prior list",
  "Prior actor",
  "Prior result",
  "Prior final result",
  "Prior polling",
  "Prior canvass result",
  "Prior call ID",
  "Prior campaign ID",
  "Used for change",
  "Pair ID",
] as const;

function matchStatusLabel(status: QcRecontactPair["matchStatus"]): string {
  switch (status) {
    case "matched":
      return "Matched";
    case "unmatched":
      return "Unmatched";
    case "no_pdi":
      return "No PDI";
    default:
      return status;
  }
}

function timeFromIso(value: string): string {
  const stamp = value.trim();
  if (!stamp) return "";
  const t = stamp.includes("T") ? stamp.slice(stamp.indexOf("T") + 1) : "";
  return t.replace(/Z$/i, "").slice(0, 8);
}

function priorCells(
  prior: PriorContactSummary | undefined,
  usedForChange: boolean,
  profile: SurveyScriptProfile
): string[] {
  if (!prior) {
    return ["", "", "", "", "", "", "", "", "", "", "", usedForChange ? "Yes" : "No"];
  }
  return [
    recontactChannelLabel(prior.channel),
    prior.occurredOn,
    timeFromIso(prior.callAt ?? ""),
    prior.listOrAssignment,
    prior.actorName,
    displayRecontactResultLabel(prior.resultLabel, profile),
    displayRecontactResultLabel(prior.finalResultLabel ?? "", profile),
    displayRecontactResultLabel(prior.pollingLabel ?? "", profile),
    prior.canvassLabel ?? "",
    prior.callId ?? "",
    prior.campaignId ?? "",
    usedForChange ? "Yes" : "No",
  ];
}

export function recontactPairsToCsvRows(
  pairs: readonly QcRecontactPair[],
  profile: SurveyScriptProfile = "faizahTraci"
): string[][] {
  const rows: string[][] = [];
  for (const pair of pairs) {
    const qc = pair.qc;
    const base = [
      changeKindLabel(pair.changeKind),
      matchStatusLabel(pair.matchStatus),
      qc.pdiId,
      qc.voterName ?? "",
      qc.voterAddress ?? "",
      qc.contactedAnswer ?? "",
      qc.callDate,
      timeFromIso(qc.callAt),
      qc.campaignName,
      qc.campaignId,
      qc.phonebankerName,
      qc.callId,
      displayRecontactResultLabel(qc.finalResultLabel, profile),
      displayRecontactResultLabel(qc.pollingLabel, profile),
      qc.canvassLabel,
    ];
    const priors = pair.priors;
    if (priors.length === 0) {
      rows.push([...base, ...priorCells(undefined, false, profile), pair.pairId]);
      continue;
    }
    const source = firstClassifiablePrior(priors);
    priors.forEach((prior) => {
      const usedForChange = Boolean(
        source &&
          prior.channel === source.channel &&
          prior.occurredOn === source.occurredOn &&
          (prior.callId ?? prior.campaignContactId ?? "") === (source.callId ?? source.campaignContactId ?? "")
      );
      rows.push([...base, ...priorCells(prior, usedForChange, profile), pair.pairId]);
    });
  }
  return rows;
}

/** RFC 4180 CSV of the visible recontact table. One row per QC call × prior. */
export function buildRecontactPairsCsv(
  pairs: readonly QcRecontactPair[],
  profile: SurveyScriptProfile = "faizahTraci"
): string {
  const lines = [
    RECONTACT_CSV_HEADERS.map((h) => escapeCsvCell(h)).join(","),
    ...recontactPairsToCsvRows(pairs, profile).map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")),
  ];
  return lines.join("\r\n");
}

export function recontactExportFilename(tagId: string, pairs: readonly QcRecontactPair[]): string {
  const dates = [...new Set(pairs.map((p) => p.qc.callDate).filter(Boolean))].sort();
  const range = dates.length === 0 ? new Date().toISOString().slice(0, 10) : dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}_to_${dates[dates.length - 1]}`;
  const slug = tagId.replace(/[^a-z0-9_-]/gi, "") || "recontacts";
  return `recontacts-${slug}-${range}.csv`;
}
