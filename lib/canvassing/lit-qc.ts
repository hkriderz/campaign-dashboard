/**
 * Lit QC: later door checks of lit left at not-homes, grouped by the canvasser who left it.
 * Pure module — knock-index I/O stays in the route.
 */
import { DateTime } from "luxon";
import { escapeCsvCell } from "../pivot-csv-export";
import { formatOverviewPercent } from "../qc-recontact/canvasser-overview";
import { canvasserIdentityKey, preferredCanvasserName } from "./display-names";
import { canonical, shortDispositionLabel } from "./doorknocks-results/helpers";
import { isKnockNonContactQuestion } from "./knock-dispositions";

export const LIT_QC_UNMATCHED = "Unmatched";
const LA_TIME_ZONE = "America/Los_Angeles";

export type LitObservation = "saw" | "didnt" | "usaFlag";
export type FlyerAnswer = "got" | "didnt" | "undecided";

export type LitQcSourceRow = {
  primaryId: string;
  canvasserName: string;
  assignmentName: string;
  occurredAt: string;
  question: string;
  response: string;
  voterName?: string;
};

export type LitQcVoter = {
  primaryId: string;
  voterName: string;
  flyer: FlyerAnswer | null;
  originalCanvasser: string;
  /** Short disposition the original canvasser marked that day (usually Not Home). */
  originalMark: string;
  project: string;
  projectDate: string;
};

export type LitQcHousehold = {
  key: string;
  lit: LitObservation | null;
  litDisagreement: boolean;
  qcCanvasser: string;
  qcAt: string;
  /** LA calendar day of the QC knock. Used when the household has no project date. */
  qcDate: string;
  project: string;
  projectDate: string;
  voters: LitQcVoter[];
};

export type LitQcCanvasserRow = {
  canvasserName: string;
  householdsChecked: number;
  votersChecked: number;
  sawLit: number;
  didntSeeLit: number;
  usaFlag: number;
  /** Saw lit ÷ (saw + didn't see + USA flag). Null when no household answered. */
  sawLitRate: number | null;
  gotFlyer: number;
  didntGetFlyer: number;
  flyerUndecided: number;
  /** Got flyer ÷ (got + didn't get). Undecided stays out. Null when nobody answered definitely. */
  receivedRate: number | null;
  households: LitQcHousehold[];
};

export type LitQcTally = {
  hasLitQuestions: boolean;
  minDate: string;
  maxDate: string;
  projects: string[];
  canvassers: LitQcCanvasserRow[];
};

export type LitQcFilter = {
  startDate?: string;
  endDate?: string;
  projects?: readonly string[];
};

type PriorHit = {
  canvasserName: string;
  project: string;
  projectDate: string;
  occurredAt: string;
  /** Raw prior response; shown as a short disposition like Not Home. */
  response: string;
};

type VoterVisit = {
  primaryId: string;
  voterName: string;
  qcCanvasser: string;
  qcKey: string;
  occurredAt: string;
  lit: LitObservation | null;
  litConflict: boolean;
  flyer: FlyerAnswer | null;
  prior: PriorHit | null;
};

export function isLitObservationQuestion(question: string): boolean {
  return canonical(question).includes("lit observation");
}

export function isFlyerReceiptQuestion(question: string): boolean {
  const value = canonical(question);
  return value.includes("receive our flyer") || value.includes("folleto");
}

export function classifyLitObservation(response: string): LitObservation | null {
  const value = canonical(response);
  if (!value) return null;
  if (value.includes("usa flag")) return "usaFlag";
  if (value.includes("didn t see") || value.includes("didnt see") || value.includes("no hay volante")) return "didnt";
  if (value.includes("saw lit") || value.includes("hay volante")) return "saw";
  return null;
}

export function classifyFlyerAnswer(response: string): FlyerAnswer | null {
  const value = canonical(response);
  if (!value) return null;
  if (value.includes("undecided") || value.includes("indeciso")) return "undecided";
  if (value.includes("didn t get") || value.includes("didnt get") || value.includes("no recibi")) return "didnt";
  if (value.includes("got a flyer") || value.includes("recibi")) return "got";
  return null;
}

export function litObservationLabel(lit: LitObservation | null, disagreement: boolean): string {
  if (disagreement) return "Lit answers disagree";
  if (lit === "saw") return "Saw lit";
  if (lit === "didnt") return "Didn't see lit";
  if (lit === "usaFlag") return "USA flag";
  // Blank when the QC visit only answered the flyer question.
  return "";
}

export function originalMarkLabel(response: string): string {
  return shortDispositionLabel(response);
}

export function flyerAnswerLabel(flyer: FlyerAnswer | null): string {
  if (flyer === "got") return "Got flyer";
  if (flyer === "didnt") return "Didn't get flyer";
  if (flyer === "undecided") return "Undecided";
  return "";
}

function rate(part: number, whole: number): number | null {
  if (!whole) return null;
  return part / whole;
}

export function laDate(occurredAt: string): string {
  const stamp = occurredAt.trim();
  if (!stamp) return "";
  const parsed = DateTime.fromISO(stamp, { setZone: true });
  if (parsed.isValid) return parsed.setZone(LA_TIME_ZONE).toISODate() ?? "";
  const day = stamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function isNotHomeLeftFlyer(response: string): boolean {
  const value = canonical(response);
  if (!value) return false;
  if (value.includes("not home") || /(^|\s)nh(\s|$)/.test(value)) return true;
  if (value.includes("left flyer")) return true;
  if (value.includes("dejo volante") && !value.includes("no dejo") && !value.includes("no flyer")) return true;
  return false;
}

function rowFromHouseholds(canvasserName: string, households: LitQcHousehold[]): LitQcCanvasserRow {
  let sawLit = 0;
  let didntSeeLit = 0;
  let usaFlag = 0;
  let votersChecked = 0;
  let gotFlyer = 0;
  let didntGetFlyer = 0;
  let flyerUndecided = 0;

  for (const household of households) {
    if (!household.litDisagreement) {
      if (household.lit === "saw") sawLit += 1;
      else if (household.lit === "didnt") didntSeeLit += 1;
      else if (household.lit === "usaFlag") usaFlag += 1;
    }
    for (const voter of household.voters) {
      votersChecked += 1;
      if (voter.flyer === "got") gotFlyer += 1;
      else if (voter.flyer === "didnt") didntGetFlyer += 1;
      else if (voter.flyer === "undecided") flyerUndecided += 1;
    }
  }

  return {
    canvasserName,
    householdsChecked: households.length,
    votersChecked,
    sawLit,
    didntSeeLit,
    usaFlag,
    sawLitRate: rate(sawLit, sawLit + didntSeeLit + usaFlag),
    gotFlyer,
    didntGetFlyer,
    flyerUndecided,
    receivedRate: rate(gotFlyer, gotFlyer + didntGetFlyer),
    households,
  };
}

export function summarizeLitQc(rows: readonly LitQcCanvasserRow[]): LitQcCanvasserRow | null {
  if (!rows.length) return null;
  return rowFromHouseholds(
    "Total",
    rows.flatMap((row) => row.households)
  );
}

function tallyMeta(rows: readonly LitQcSourceRow[], canvassers: LitQcCanvasserRow[]): LitQcTally {
  const dates: string[] = [];
  const projects = new Set<string>();
  for (const canvasser of canvassers) {
    for (const household of canvasser.households) {
      const day = household.projectDate || household.qcDate;
      if (day) dates.push(day);
      if (household.project) projects.add(household.project);
    }
  }
  dates.sort();
  return {
    hasLitQuestions: rows.some((row) => isLitObservationQuestion(row.question) || isFlyerReceiptQuestion(row.question)),
    minDate: dates[0] ?? "",
    maxDate: dates[dates.length - 1] ?? "",
    projects: [...projects].sort((a, b) => a.localeCompare(b)),
    canvassers,
  };
}

function indexPriors(rows: readonly LitQcSourceRow[]): Map<string, PriorHit[]> {
  const byId = new Map<string, PriorHit[]>();
  for (const row of rows) {
    const primaryId = row.primaryId.trim();
    if (!primaryId || !row.canvasserName.trim()) continue;
    if (!isKnockNonContactQuestion(row.question) || !isNotHomeLeftFlyer(row.response)) continue;
    const hit: PriorHit = {
      canvasserName: row.canvasserName.trim(),
      project: row.assignmentName.trim(),
      projectDate: laDate(row.occurredAt),
      occurredAt: row.occurredAt.trim(),
      response: row.response.trim(),
    };
    const list = byId.get(primaryId) ?? [];
    list.push(hit);
    byId.set(primaryId, list);
  }
  for (const list of byId.values()) {
    list.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  return byId;
}

function latestPrior(priors: readonly PriorHit[] | undefined, beforeAt: string): PriorHit | null {
  if (!priors?.length) return null;
  return priors.find((prior) => prior.occurredAt < beforeAt) ?? null;
}

function buildVisits(rows: readonly LitQcSourceRow[], priors: Map<string, PriorHit[]>): VoterVisit[] {
  const visits = new Map<string, VoterVisit>();
  for (const row of rows) {
    const litQuestion = isLitObservationQuestion(row.question);
    const flyerQuestion = isFlyerReceiptQuestion(row.question);
    if (!litQuestion && !flyerQuestion) continue;
    const primaryId = row.primaryId.trim();
    if (!primaryId) continue;
    const occurredAt = row.occurredAt.trim();
    const qcCanvasser = row.canvasserName.trim();
    const qcKey = canvasserIdentityKey(qcCanvasser) || qcCanvasser.toLowerCase();
    const key = `${primaryId}\0${qcKey}\0${occurredAt}`;
    const visit = visits.get(key) ?? {
      primaryId,
      voterName: "",
      qcCanvasser,
      qcKey,
      occurredAt,
      lit: null,
      litConflict: false,
      flyer: null,
      prior: latestPrior(priors.get(primaryId), occurredAt),
    };
    const voterName = (row.voterName ?? "").trim();
    if (voterName && !visit.voterName) visit.voterName = voterName;
    if (qcCanvasser && !visit.qcCanvasser) visit.qcCanvasser = qcCanvasser;
    if (litQuestion) {
      const lit = classifyLitObservation(row.response);
      if (lit && visit.lit && visit.lit !== lit) visit.litConflict = true;
      else if (lit) visit.lit = lit;
    }
    if (flyerQuestion) {
      const flyer = classifyFlyerAnswer(row.response);
      if (flyer) visit.flyer = flyer;
    }
    visits.set(key, visit);
  }
  return [...visits.values()];
}

function householdLit(visits: readonly VoterVisit[]): { lit: LitObservation | null; litDisagreement: boolean } {
  if (visits.some((visit) => visit.litConflict)) return { lit: null, litDisagreement: true };
  const answers = new Set(visits.map((visit) => visit.lit).filter((lit): lit is LitObservation => Boolean(lit)));
  if (answers.size > 1) return { lit: null, litDisagreement: true };
  return { lit: [...answers][0] ?? null, litDisagreement: false };
}

function ownerOf(visits: readonly VoterVisit[]): { key: string; name: string; project: string; projectDate: string } {
  const groups = new Map<string, { names: string[]; project: string; projectDate: string; count: number }>();
  for (const visit of visits) {
    if (!visit.prior) continue;
    const key = canvasserIdentityKey(visit.prior.canvasserName) || visit.prior.canvasserName.toLowerCase();
    const group = groups.get(key) ?? { names: [], project: "", projectDate: "", count: 0 };
    group.names.push(visit.prior.canvasserName);
    group.count += 1;
    if (!group.projectDate || visit.prior.projectDate > group.projectDate) {
      group.project = visit.prior.project;
      group.projectDate = visit.prior.projectDate;
    }
    groups.set(key, group);
  }
  let best: { key: string; name: string; project: string; projectDate: string; count: number } | null = null;
  for (const [key, group] of groups) {
    const candidate = {
      key,
      name: preferredCanvasserName(group.names),
      project: group.project,
      projectDate: group.projectDate,
      count: group.count,
    };
    if (
      !best ||
      candidate.count > best.count ||
      (candidate.count === best.count && candidate.projectDate > best.projectDate) ||
      (candidate.count === best.count && candidate.projectDate === best.projectDate && candidate.name.localeCompare(best.name) < 0)
    ) {
      best = candidate;
    }
  }
  if (!best) return { key: "", name: LIT_QC_UNMATCHED, project: "", projectDate: "" };
  return best;
}

function buildHouseholds(visits: readonly VoterVisit[]): Map<string, { ownerKey: string; household: LitQcHousehold }> {
  const groups = new Map<string, VoterVisit[]>();
  for (const visit of visits) {
    const door = visit.occurredAt ? `${visit.qcKey}\0${visit.occurredAt}` : `${visit.qcKey}\0${visit.primaryId}`;
    const list = groups.get(door) ?? [];
    list.push(visit);
    groups.set(door, list);
  }

  const households = new Map<string, { ownerKey: string; household: LitQcHousehold }>();
  for (const [key, doorVisits] of groups) {
    const owner = ownerOf(doorVisits);
    const lit = householdLit(doorVisits);
    const qcNames = doorVisits.map((visit) => visit.qcCanvasser);
    const first = doorVisits[0]!;
    const voters = doorVisits
      .map((visit) => ({
        primaryId: visit.primaryId,
        voterName: visit.voterName,
        flyer: visit.flyer,
        originalCanvasser: visit.prior?.canvasserName ?? "",
        originalMark: visit.prior ? originalMarkLabel(visit.prior.response) : "",
        project: visit.prior?.project ?? "",
        projectDate: visit.prior?.projectDate ?? "",
      }))
      .sort((a, b) => a.voterName.localeCompare(b.voterName) || a.primaryId.localeCompare(b.primaryId));
    households.set(key, {
      ownerKey: owner.key,
      household: {
        key,
        lit: lit.lit,
        litDisagreement: lit.litDisagreement,
        qcCanvasser: preferredCanvasserName(qcNames),
        qcAt: first.occurredAt,
        qcDate: laDate(first.occurredAt),
        project: owner.project,
        projectDate: owner.projectDate,
        voters,
      },
    });
  }
  return households;
}

export function buildLitQc(rows: readonly LitQcSourceRow[]): LitQcTally {
  const priors = indexPriors(rows);
  const grouped = buildHouseholds(buildVisits(rows, priors));
  const byCanvasser = new Map<string, { names: string[]; households: LitQcHousehold[] }>();

  for (const { ownerKey, household } of grouped.values()) {
    const key = ownerKey || LIT_QC_UNMATCHED;
    const names = household.voters.map((voter) => voter.originalCanvasser).filter(Boolean);
    const bucket = byCanvasser.get(key) ?? { names: [], households: [] };
    if (key !== LIT_QC_UNMATCHED) bucket.names.push(...names);
    bucket.households.push(household);
    byCanvasser.set(key, bucket);
  }

  const canvassers = [...byCanvasser.entries()]
    .map(([key, bucket]) => {
      const name = key === LIT_QC_UNMATCHED ? LIT_QC_UNMATCHED : preferredCanvasserName(bucket.names);
      const households = [...bucket.households].sort(
        (a, b) => a.qcAt.localeCompare(b.qcAt) || a.project.localeCompare(b.project) || a.key.localeCompare(b.key)
      );
      return rowFromHouseholds(name, households);
    })
    .sort((a, b) => {
      if (a.canvasserName === LIT_QC_UNMATCHED) return 1;
      if (b.canvasserName === LIT_QC_UNMATCHED) return -1;
      return a.canvasserName.localeCompare(b.canvasserName);
    });

  return tallyMeta(rows, canvassers);
}

function householdInFilter(household: LitQcHousehold, filter: LitQcFilter): boolean {
  const day = household.projectDate || household.qcDate;
  const start = filter.startDate?.trim() ?? "";
  const end = filter.endDate?.trim() ?? "";
  if (start && (!day || day < start)) return false;
  if (end && (!day || day > end)) return false;
  const projects = (filter.projects ?? []).map((project) => project.trim()).filter(Boolean);
  if (projects.length && !projects.includes(household.project)) return false;
  return true;
}

export function filterLitQc(tally: LitQcTally, filter: LitQcFilter): LitQcTally {
  const canvassers = tally.canvassers
    .map((row) => rowFromHouseholds(row.canvasserName, row.households.filter((household) => householdInFilter(household, filter))))
    .filter((row) => row.householdsChecked > 0);
  return {
    ...tally,
    canvassers,
  };
}

export function litQcProjectsInDateRange(tally: LitQcTally, startDate: string, endDate: string): string[] {
  const dated = filterLitQc(tally, { startDate, endDate });
  const projects = new Set<string>();
  for (const canvasser of dated.canvassers) {
    for (const household of canvasser.households) {
      if (household.project) projects.add(household.project);
    }
  }
  return [...projects].sort((a, b) => a.localeCompare(b));
}

const SUMMARY_HEADERS = [
  "Canvasser",
  "Households",
  "Voters",
  "Saw lit",
  "Didn't see lit",
  "USA flag",
  "Saw lit %",
  "Got flyer",
  "Didn't get flyer",
  "Undecided",
  "Received %",
] as const;

export type LitQcDetailColumnId =
  | "canvasserName"
  | "originalMark"
  | "litObservation"
  | "qcCanvasser"
  | "qcTime"
  | "project"
  | "projectDate"
  | "voterName"
  | "pdiId"
  | "flyer"
  | "voterOriginalCanvasser"
  | "voterProject"
  | "voterProjectDate";

export type LitQcDetailColumnDef = {
  id: LitQcDetailColumnId;
  label: string;
  header: string;
};

export const LIT_QC_DETAIL_COLUMNS: readonly LitQcDetailColumnDef[] = [
  { id: "canvasserName", label: "Original canvasser", header: "Original canvasser" },
  { id: "originalMark", label: "Original mark", header: "Original mark" },
  { id: "litObservation", label: "Lit observation", header: "Lit observation" },
  { id: "qcCanvasser", label: "QC canvasser", header: "QC canvasser" },
  { id: "qcTime", label: "QC time", header: "QC time" },
  { id: "project", label: "Project", header: "Project" },
  { id: "projectDate", label: "Project date", header: "Project date" },
  { id: "voterName", label: "Voter", header: "Voter" },
  { id: "pdiId", label: "PDI", header: "PDI" },
  { id: "flyer", label: "Flyer", header: "Flyer" },
  { id: "voterOriginalCanvasser", label: "Voter original canvasser", header: "Voter original canvasser" },
  { id: "voterProject", label: "Voter project", header: "Voter project" },
  { id: "voterProjectDate", label: "Voter project date", header: "Voter project date" },
] as const;

export const ALL_LIT_QC_DETAIL_COLUMN_IDS: readonly LitQcDetailColumnId[] = LIT_QC_DETAIL_COLUMNS.map(
  (column) => column.id
);

export const LIT_QC_DETAIL_COLS_STORAGE_KEY = "campaign-dashboard:lit-qc-detail-cols:v2";

/** Default: hide the per-voter prior columns unless the door priors disagree. */
export const DEFAULT_LIT_QC_DETAIL_COLUMN_IDS: readonly LitQcDetailColumnId[] = [
  "canvasserName",
  "originalMark",
  "litObservation",
  "qcCanvasser",
  "qcTime",
  "project",
  "projectDate",
  "voterName",
  "pdiId",
  "flyer",
];

export type LitQcDetailRow = {
  canvasserName: string;
  originalMark: string;
  litObservation: string;
  qcCanvasser: string;
  qcTime: string;
  project: string;
  projectDate: string;
  voterName: string;
  pdiId: string;
  flyer: string;
  voterOriginalCanvasser: string;
  voterProject: string;
  voterProjectDate: string;
};

export function defaultVisibleLitQcDetailColumnIds(): LitQcDetailColumnId[] {
  return [...DEFAULT_LIT_QC_DETAIL_COLUMN_IDS];
}

export function parseLitQcDetailColumnIds(raw: string | null): LitQcDetailColumnId[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const known = new Set(ALL_LIT_QC_DETAIL_COLUMN_IDS);
    const selected = new Set(
      parsed.filter((id): id is LitQcDetailColumnId => typeof id === "string" && known.has(id as LitQcDetailColumnId))
    );
    if (!selected.size) return null;
    return ALL_LIT_QC_DETAIL_COLUMN_IDS.filter((id) => selected.has(id));
  } catch {
    return null;
  }
}

export function loadLitQcDetailColumnIds(): LitQcDetailColumnId[] {
  if (typeof window === "undefined") return defaultVisibleLitQcDetailColumnIds();
  try {
    return parseLitQcDetailColumnIds(window.localStorage.getItem(LIT_QC_DETAIL_COLS_STORAGE_KEY)) ?? defaultVisibleLitQcDetailColumnIds();
  } catch {
    return defaultVisibleLitQcDetailColumnIds();
  }
}

export function saveLitQcDetailColumnIds(ids: readonly LitQcDetailColumnId[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIT_QC_DETAIL_COLS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / private mode
  }
}

export function toggleLitQcDetailColumn(
  current: readonly LitQcDetailColumnId[],
  id: LitQcDetailColumnId,
  on: boolean
): LitQcDetailColumnId[] {
  const set = new Set(current);
  if (on) set.add(id);
  else {
    if (set.size <= 1 && set.has(id)) return ALL_LIT_QC_DETAIL_COLUMN_IDS.filter((column) => set.has(column));
    set.delete(id);
  }
  if (!set.size) return defaultVisibleLitQcDetailColumnIds();
  return ALL_LIT_QC_DETAIL_COLUMN_IDS.filter((column) => set.has(column));
}

export function flattenLitQcDetails(rows: readonly LitQcCanvasserRow[]): LitQcDetailRow[] {
  const details: LitQcDetailRow[] = [];
  for (const row of rows) {
    for (const household of row.households) {
      const lit = litObservationLabel(household.lit, household.litDisagreement);
      if (!household.voters.length) {
        details.push({
          canvasserName: row.canvasserName,
          originalMark: "",
          litObservation: lit,
          qcCanvasser: household.qcCanvasser,
          qcTime: household.qcAt,
          project: household.project,
          projectDate: household.projectDate,
          voterName: "",
          pdiId: "",
          flyer: "",
          voterOriginalCanvasser: "",
          voterProject: "",
          voterProjectDate: "",
        });
        continue;
      }
      for (const voter of household.voters) {
        details.push({
          canvasserName: row.canvasserName,
          originalMark: voter.originalMark,
          litObservation: lit,
          qcCanvasser: household.qcCanvasser,
          qcTime: household.qcAt,
          project: household.project,
          projectDate: household.projectDate,
          voterName: voter.voterName,
          pdiId: voter.primaryId,
          flyer: flyerAnswerLabel(voter.flyer),
          voterOriginalCanvasser: voter.originalCanvasser,
          voterProject: voter.project,
          voterProjectDate: voter.projectDate,
        });
      }
    }
  }
  return details;
}

export function litQcDetailHeaders(ids: readonly LitQcDetailColumnId[]): string[] {
  const byId = new Map(LIT_QC_DETAIL_COLUMNS.map((column) => [column.id, column.header] as const));
  return ids.map((id) => byId.get(id) ?? id);
}

export function litQcDetailCellValue(detail: LitQcDetailRow, id: LitQcDetailColumnId): string {
  switch (id) {
    case "canvasserName":
      return detail.canvasserName;
    case "originalMark":
      return detail.originalMark;
    case "litObservation":
      return detail.litObservation;
    case "qcCanvasser":
      return detail.qcCanvasser;
    case "qcTime":
      return detail.qcTime;
    case "project":
      return detail.project;
    case "projectDate":
      return detail.projectDate;
    case "voterName":
      return detail.voterName;
    case "pdiId":
      return detail.pdiId;
    case "flyer":
      return detail.flyer;
    case "voterOriginalCanvasser":
      return detail.voterOriginalCanvasser;
    case "voterProject":
      return detail.voterProject;
    case "voterProjectDate":
      return detail.voterProjectDate;
    default:
      return "";
  }
}

export function litQcDetailValues(detail: LitQcDetailRow, ids: readonly LitQcDetailColumnId[]): string[] {
  return ids.map((id) => litQcDetailCellValue(detail, id));
}

function summaryCells(row: LitQcCanvasserRow): string[] {
  return [
    row.canvasserName,
    String(row.householdsChecked),
    String(row.votersChecked),
    String(row.sawLit),
    String(row.didntSeeLit),
    String(row.usaFlag),
    formatOverviewPercent(row.sawLitRate),
    String(row.gotFlyer),
    String(row.didntGetFlyer),
    String(row.flyerUndecided),
    formatOverviewPercent(row.receivedRate),
  ];
}

export function buildLitQcCsv(
  rows: readonly LitQcCanvasserRow[],
  visibleDetailColumnIds: readonly LitQcDetailColumnId[] = ALL_LIT_QC_DETAIL_COLUMN_IDS
): string {
  const detailIds = visibleDetailColumnIds.length ? visibleDetailColumnIds : ALL_LIT_QC_DETAIL_COLUMN_IDS;
  const lines = [SUMMARY_HEADERS.map((header) => escapeCsvCell(header)).join(",")];
  const total = summarizeLitQc(rows);
  if (total) lines.push(summaryCells(total).map((cell) => escapeCsvCell(cell)).join(","));
  for (const row of rows) lines.push(summaryCells(row).map((cell) => escapeCsvCell(cell)).join(","));

  lines.push("");
  lines.push(litQcDetailHeaders(detailIds).map((header) => escapeCsvCell(header)).join(","));
  for (const detail of flattenLitQcDetails(rows)) {
    lines.push(litQcDetailValues(detail, detailIds).map((cell) => escapeCsvCell(cell)).join(","));
  }
  return lines.join("\r\n");
}

/** Detail-only TSV for clipboard, matching the other overview Copy table buttons. */
export function buildLitQcDetailTsv(
  rows: readonly LitQcCanvasserRow[],
  visibleDetailColumnIds: readonly LitQcDetailColumnId[] = DEFAULT_LIT_QC_DETAIL_COLUMN_IDS
): string {
  const detailIds = visibleDetailColumnIds.length ? visibleDetailColumnIds : DEFAULT_LIT_QC_DETAIL_COLUMN_IDS;
  const lines = [litQcDetailHeaders(detailIds).join("\t")];
  for (const detail of flattenLitQcDetails(rows)) {
    lines.push(
      litQcDetailValues(detail, detailIds)
        .map((cell) => String(cell).replace(/\t/g, " ").replace(/\r?\n/g, " "))
        .join("\t")
    );
  }
  return lines.join("\n");
}

export function buildLitQcTsv(rows: readonly LitQcCanvasserRow[]): string {
  const lines = [SUMMARY_HEADERS.join("\t")];
  const total = summarizeLitQc(rows);
  if (total) lines.push(summaryCells(total).join("\t"));
  for (const row of rows) lines.push(summaryCells(row).join("\t"));
  return lines.join("\n");
}
