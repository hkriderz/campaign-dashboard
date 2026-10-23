/**
 * Phone-bank, canvass-project, and people filters for QC recontacts and overviews.
 * An empty checklist is no constraint. Within a checklist, checked items are OR.
 * Across checklists they are AND.
 */

import { canonicalizePhonebankerName } from "../phonebanker-name";
import { groupRecontactDisplayNames, recontactNamesMatch } from "./names";
import type { QcRecontactPair } from "./types";

export type PeopleFilterMode = "include" | "exclude";

export type ProjectPeopleFilter = {
  phoneBanks: readonly string[];
  canvassProjects: readonly string[];
  canvassers: readonly string[];
  canvasserMode: PeopleFilterMode;
  phonebankers: readonly string[];
  phonebankerMode: PeopleFilterMode;
  qcCallers: readonly string[];
  qcCallerMode: PeopleFilterMode;
};

export type ProjectPeopleOptions = {
  phoneBanks: string[];
  canvassProjects: string[];
  canvassers: string[];
  phonebankers: string[];
  qcCallers: string[];
};

export function emptyProjectPeopleFilter(): ProjectPeopleFilter {
  return {
    phoneBanks: [],
    canvassProjects: [],
    canvassers: [],
    canvasserMode: "include",
    phonebankers: [],
    phonebankerMode: "include",
    qcCallers: [],
    qcCallerMode: "include",
  };
}

function trimmed(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

export function phonebankerNamesMatch(leftRaw: string, rightRaw: string): boolean {
  const left = canonicalizePhonebankerName(leftRaw);
  const right = canonicalizePhonebankerName(rightRaw);
  if (left && right && left.toLowerCase() === right.toLowerCase()) return true;
  return recontactNamesMatch(leftRaw, rightRaw);
}

/** Empty names show everyone. Include keeps matches. Exclude drops matches. */
export function peopleFilterPasses(
  actorNames: readonly string[],
  selected: readonly string[],
  mode: PeopleFilterMode,
  matches: (left: string, right: string) => boolean = recontactNamesMatch
): boolean {
  const wanted = trimmed(selected);
  if (wanted.length === 0) return true;
  const hit = actorNames.some((actor) => wanted.some((name) => matches(actor, name)));
  return mode === "exclude" ? !hit : hit;
}

export function filterNamedRows<T>(
  rows: readonly T[],
  selected: readonly string[],
  mode: PeopleFilterMode,
  nameOf: (row: T) => string,
  matches: (left: string, right: string) => boolean = recontactNamesMatch
): readonly T[] {
  if (trimmed(selected).length === 0) return rows;
  return rows.filter((row) => peopleFilterPasses([nameOf(row)], selected, mode, matches));
}

export function pairMatchesPhoneBanks(pair: QcRecontactPair, selected: readonly string[]): boolean {
  const wanted = new Set(trimmed(selected));
  if (wanted.size === 0) return true;
  if (wanted.has(pair.qc.campaignName.trim())) return true;
  return pair.priors.some(
    (prior) => prior.channel === "phonebank" && wanted.has(prior.listOrAssignment.trim())
  );
}

export function pairMatchesCanvassProjects(pair: QcRecontactPair, selected: readonly string[]): boolean {
  const wanted = new Set(trimmed(selected));
  if (wanted.size === 0) return true;
  return pair.priors.some(
    (prior) => prior.channel === "canvass" && wanted.has(prior.listOrAssignment.trim())
  );
}

export function pairMatchesProjectPeople(pair: QcRecontactPair, filter: ProjectPeopleFilter): boolean {
  if (!pairMatchesPhoneBanks(pair, filter.phoneBanks)) return false;
  if (!pairMatchesCanvassProjects(pair, filter.canvassProjects)) return false;
  const canvassers = pair.priors
    .filter((prior) => prior.channel === "canvass")
    .map((prior) => prior.actorName);
  if (!peopleFilterPasses(canvassers, filter.canvassers, filter.canvasserMode)) return false;
  const phonebankers = pair.priors
    .filter((prior) => prior.channel === "phonebank")
    .map((prior) => prior.actorName);
  if (!peopleFilterPasses(phonebankers, filter.phonebankers, filter.phonebankerMode, phonebankerNamesMatch)) {
    return false;
  }
  if (!peopleFilterPasses([pair.qc.phonebankerName], filter.qcCallers, filter.qcCallerMode, phonebankerNamesMatch)) {
    return false;
  }
  return true;
}

/** Labels present on these pairs. Pass the date-scoped pairs so the lists follow the date range. */
export function projectPeopleOptions(pairs: readonly QcRecontactPair[]): ProjectPeopleOptions {
  const phoneBanks: string[] = [];
  const canvassProjects: string[] = [];
  const canvassers: string[] = [];
  const phonebankers: string[] = [];
  const qcCallers: string[] = [];
  for (const pair of pairs) {
    const campaign = pair.qc.campaignName.trim();
    if (campaign) phoneBanks.push(campaign);
    const caller = canonicalizePhonebankerName(pair.qc.phonebankerName);
    if (caller) qcCallers.push(caller);
    for (const prior of pair.priors) {
      const list = prior.listOrAssignment.trim();
      if (prior.channel === "phonebank") {
        if (list) phoneBanks.push(list);
        const name = canonicalizePhonebankerName(prior.actorName);
        if (name) phonebankers.push(name);
      } else if (prior.channel === "canvass") {
        if (list) canvassProjects.push(list);
        const name = prior.actorName.trim();
        if (name) canvassers.push(name);
      }
    }
  }
  return {
    phoneBanks: sortedUnique(phoneBanks),
    canvassProjects: sortedUnique(canvassProjects),
    canvassers: groupRecontactDisplayNames(canvassers),
    phonebankers: sortedUnique(phonebankers),
    qcCallers: sortedUnique(qcCallers),
  };
}

export function listedSelection(
  selected: readonly string[],
  listed: readonly string[],
  action: "all" | "none" | "invert"
): string[] {
  const selectedSet = new Set(selected);
  if (action === "all") {
    return [...selected, ...listed.filter((item) => !selectedSet.has(item))];
  }
  if (action === "none") {
    const listedSet = new Set(listed);
    return selected.filter((item) => !listedSet.has(item));
  }
  const next = new Set(selected);
  for (const item of listed) {
    if (next.has(item)) next.delete(item);
    else next.add(item);
  }
  return [...next];
}
