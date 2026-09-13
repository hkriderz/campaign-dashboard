/**
 * Pure Canvassing Overview tallies from the saved knock index.
 * One support outcome per canvasser per voter per day; header knocks are unique PRIMARYID×day.
 */
import { DateTime } from "luxon";
import { answerMatches, canonical } from "./doorknocks-results/helpers";
import { LA_TIME_ZONE } from "./knock-details-parser";
import { normalizeRecontactPersonId } from "../qc-recontact/ids";

export type KnockSupportOutcome =
  | "strong_support"
  | "support"
  | "undecided"
  | "oppose"
  | "strong_oppose";

export type KnockIndexTallyRow = {
  primaryId: string;
  canvasserName: string;
  assignmentName: string;
  occurredAt: string;
  question: string;
  response: string;
};

export type CanvassingOverviewStats = {
  knocks: number;
  contacts: number;
  surveyed: number;
  strongSupport: number;
  support: number;
  undecided: number;
  oppose: number;
};

export type CanvasserOverviewRow = {
  canvasserName: string;
  daysWorked: number;
  knocks: number;
  contacts: number;
  surveyed: number;
  strongSupport: number;
  support: number;
  undecided: number;
  oppose: number;
  contactRate: number;
  ssRate: number;
};

export type CanvassingOverviewTally = {
  stats: CanvassingOverviewStats;
  canvassers: CanvasserOverviewRow[];
};

const STRONG_SUPPORT_LABELS = ["strong support", "fuerte apoyo"];
const SUPPORT_LABELS = ["support", "apoyo"];
const UNDECIDED_LABELS = ["undecided", "indeciso"];
const STRONG_OPPOSE_LABELS = ["strong oppose", "fuerte oposicion", "fuerte oposición"];
const OPPOSE_LABELS = ["oppose", "oposicion", "oposición"];

export function knockOccurredOnLa(occurredAt: string): string {
  const stamp = occurredAt.trim();
  if (!stamp) return "";
  const date = DateTime.fromISO(stamp, { zone: LA_TIME_ZONE });
  if (date.isValid) return date.toISODate() ?? "";
  if (/^\d{4}-\d{2}-\d{2}/.test(stamp)) return stamp.slice(0, 10);
  return "";
}

export function isNonContactQuestion(question: string): boolean {
  return canonical(question).includes("non contact");
}

/** Prop 40 / pledge / other non-ID questions stay in the index but do not steal the support tally. */
export function isPledgeOrSecondaryQuestion(question: string): boolean {
  const q = canonical(question);
  return (
    q.includes("pledge") ||
    q.includes("prop 40") ||
    q.includes("billionaire tax") ||
    q.includes("sign to")
  );
}

export function classifyKnockSupportResponse(response: string): KnockSupportOutcome | null {
  if (answerMatches(response, STRONG_SUPPORT_LABELS)) return "strong_support";
  if (answerMatches(response, STRONG_OPPOSE_LABELS)) return "strong_oppose";
  if (answerMatches(response, SUPPORT_LABELS)) return "support";
  if (answerMatches(response, UNDECIDED_LABELS)) return "undecided";
  if (answerMatches(response, OPPOSE_LABELS)) return "oppose";
  return null;
}

export function filterKnockIndexRows(
  rows: readonly KnockIndexTallyRow[],
  options: {
    startDate?: string;
    endDate?: string;
    assignmentMatches?: (assignmentName: string) => boolean;
  } = {}
): KnockIndexTallyRow[] {
  const start = options.startDate?.trim() ?? "";
  const end = options.endDate?.trim() ?? "";
  return rows.filter((row) => {
    if (options.assignmentMatches && !options.assignmentMatches(row.assignmentName)) return false;
    if (!start && !end) return true;
    const day = knockOccurredOnLa(row.occurredAt);
    if (!day) return false;
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  });
}

type ClassifiedRow = KnockIndexTallyRow & {
  day: string;
  personId: string;
  outcome: KnockSupportOutcome | null;
  isContact: boolean;
};

function classifyRow(row: KnockIndexTallyRow): ClassifiedRow | null {
  const day = knockOccurredOnLa(row.occurredAt);
  const personId = normalizeRecontactPersonId(row.primaryId);
  if (!day || !personId) return null;
  const isContact = !isNonContactQuestion(row.question);
  const outcome = isContact ? classifyKnockSupportResponse(row.response) : null;
  return { ...row, day, personId, outcome, isContact };
}

function compareOccurredAt(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Last classified ID/support question that day. Pledge rows only win when they are
 * the only classified answers.
 */
export function pickSupportOutcome(rows: readonly ClassifiedRow[]): KnockSupportOutcome | null {
  const classified = [...rows]
    .filter((row) => row.outcome && row.isContact)
    .sort((a, b) => compareOccurredAt(a.occurredAt, b.occurredAt));
  if (!classified.length) return null;

  const pool = classified.filter((row) => !isPledgeOrSecondaryQuestion(row.question));
  const chosen = (pool.length ? pool : classified).at(-1);
  return chosen?.outcome ?? null;
}

function emptyStats(): CanvassingOverviewStats {
  return {
    knocks: 0,
    contacts: 0,
    surveyed: 0,
    strongSupport: 0,
    support: 0,
    undecided: 0,
    oppose: 0,
  };
}

function applyOutcome(stats: { strongSupport: number; support: number; undecided: number; oppose: number }, outcome: KnockSupportOutcome): void {
  if (outcome === "strong_support") stats.strongSupport += 1;
  else if (outcome === "support") stats.support += 1;
  else if (outcome === "undecided") stats.undecided += 1;
  else stats.oppose += 1;
}

function rate(part: number, whole: number): number {
  if (!whole) return 0;
  return part / whole;
}

export function tallyCanvassingOverview(rows: readonly KnockIndexTallyRow[]): CanvassingOverviewTally {
  const classified = rows.map(classifyRow).filter((row): row is ClassifiedRow => row !== null);

  const voterDays = new Map<string, ClassifiedRow[]>();
  const canvasserVoterDays = new Map<string, ClassifiedRow[]>();
  const canvasserDays = new Map<string, Set<string>>();

  for (const row of classified) {
    const voterKey = `${row.personId}|${row.day}`;
    const canvasserKey = `${row.canvasserName}|${voterKey}`;
    const voterList = voterDays.get(voterKey) ?? [];
    voterList.push(row);
    voterDays.set(voterKey, voterList);
    const canvasserList = canvasserVoterDays.get(canvasserKey) ?? [];
    canvasserList.push(row);
    canvasserVoterDays.set(canvasserKey, canvasserList);
    const days = canvasserDays.get(row.canvasserName) ?? new Set<string>();
    days.add(row.day);
    canvasserDays.set(row.canvasserName, days);
  }

  const stats = emptyStats();
  for (const group of voterDays.values()) {
    stats.knocks += 1;
    if (group.some((row) => row.isContact)) stats.contacts += 1;
    const outcome = pickSupportOutcome(group);
    if (!outcome) continue;
    stats.surveyed += 1;
    applyOutcome(stats, outcome);
  }

  const byCanvasser = new Map<
    string,
    {
      knocks: number;
      contacts: number;
      surveyed: number;
      strongSupport: number;
      support: number;
      undecided: number;
      oppose: number;
    }
  >();

  for (const [key, group] of canvasserVoterDays) {
    const canvasserName = key.slice(0, key.indexOf("|"));
    const bucket = byCanvasser.get(canvasserName) ?? {
      knocks: 0,
      contacts: 0,
      surveyed: 0,
      strongSupport: 0,
      support: 0,
      undecided: 0,
      oppose: 0,
    };
    bucket.knocks += 1;
    if (group.some((row) => row.isContact)) bucket.contacts += 1;
    const outcome = pickSupportOutcome(group);
    if (outcome) {
      bucket.surveyed += 1;
      applyOutcome(bucket, outcome);
    }
    byCanvasser.set(canvasserName, bucket);
  }

  const canvassers: CanvasserOverviewRow[] = [...byCanvasser.entries()]
    .map(([canvasserName, bucket]) => ({
      canvasserName,
      daysWorked: canvasserDays.get(canvasserName)?.size ?? 0,
      knocks: bucket.knocks,
      contacts: bucket.contacts,
      surveyed: bucket.surveyed,
      strongSupport: bucket.strongSupport,
      support: bucket.support,
      undecided: bucket.undecided,
      oppose: bucket.oppose,
      contactRate: rate(bucket.contacts, bucket.knocks),
      ssRate: rate(bucket.strongSupport, bucket.surveyed),
    }))
    .sort((a, b) => b.strongSupport - a.strongSupport || a.canvasserName.localeCompare(b.canvasserName));

  return { stats, canvassers };
}
