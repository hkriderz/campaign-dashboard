import test from "node:test";
import assert from "node:assert/strict";
import {
  addMembersToActorGroup,
  createActorGroup,
  deleteActorGroup,
  parseActorGroups,
} from "./actor-groups";
import { filterPairsByQcDateRange } from "./pair";
import {
  emptyProjectPeopleFilter,
  listedSelection,
  pairMatchesProjectPeople,
  projectPeopleOptions,
} from "./project-people-filter";
import type { QcRecontactPair, RecontactCallSummary } from "./types";

function call(partial: Partial<RecontactCallSummary> & Pick<RecontactCallSummary, "callId" | "callDate">): RecontactCallSummary {
  return {
    campaignId: "c1",
    campaignName: "QC List A",
    callAt: `${partial.callDate}T12:00:00`,
    phonebankerName: "Alex",
    pdiId: "CA1",
    voterName: "",
    voterAddress: "",
    finalResultLabel: "Strong Support",
    pollingLabel: "",
    canvassLabel: "Talking to correct person",
    contactedQuestion: "",
    contactedAnswer: "",
    notesAnswer: "",
    ...partial,
  };
}

function pair(partial: Partial<QcRecontactPair> & Pick<QcRecontactPair, "pairId" | "qc">): QcRecontactPair {
  return {
    matchStatus: "matched",
    changeKind: "held",
    priors: [],
    ...partial,
  };
}

const phoneAndCanvass = pair({
  pairId: "both",
  qc: call({ callId: "qc1", callDate: "2026-10-19", campaignName: "QC List A", phonebankerName: "Alex" }),
  priors: [
    {
      channel: "phonebank",
      pdiId: "CA1",
      actorName: "Maria Lopez",
      occurredOn: "2026-10-01",
      listOrAssignment: "Night Bank",
      resultLabel: "Strong Support",
    },
    {
      channel: "canvass",
      pdiId: "CA1",
      actorName: "Nguyen, Dave",
      occurredOn: "2026-10-02",
      listOrAssignment: "Turf 4",
      resultLabel: "Undecided",
    },
  ],
});

const otherDay = pair({
  pairId: "other",
  qc: call({ callId: "qc2", callDate: "2026-10-18", campaignName: "QC List B", phonebankerName: "Blair" }),
  priors: [
    {
      channel: "canvass",
      pdiId: "CA2",
      actorName: "Sam Door",
      occurredOn: "2026-10-01",
      listOrAssignment: "Turf 9",
      resultLabel: "Strong Support",
    },
  ],
});

test("empty project and people filters keep every pair", () => {
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, emptyProjectPeopleFilter()), true);
  assert.equal(pairMatchesProjectPeople(otherDay, emptyProjectPeopleFilter()), true);
});

test("phone banks match the QC list or a prior phone bank", () => {
  const qcList = { ...emptyProjectPeopleFilter(), phoneBanks: ["QC List A"] };
  const priorBank = { ...emptyProjectPeopleFilter(), phoneBanks: ["Night Bank"] };
  const both = { ...emptyProjectPeopleFilter(), phoneBanks: ["QC List B", "Night Bank"] };
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, qcList), true);
  assert.equal(pairMatchesProjectPeople(otherDay, qcList), false);
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, priorBank), true);
  assert.equal(pairMatchesProjectPeople(otherDay, priorBank), false);
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, both), true);
  assert.equal(pairMatchesProjectPeople(otherDay, both), true);
});

test("canvass project and canvasser filters AND together", () => {
  const projectOnly = { ...emptyProjectPeopleFilter(), canvassProjects: ["Turf 4"] };
  const personOnly = {
    ...emptyProjectPeopleFilter(),
    canvassers: ["Dave Nguyen"],
    canvasserMode: "include" as const,
  };
  const both = { ...projectOnly, canvassers: ["Dave Nguyen"], canvasserMode: "include" as const };
  const mismatch = { ...projectOnly, canvassers: ["Sam Door"], canvasserMode: "include" as const };
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, projectOnly), true);
  assert.equal(pairMatchesProjectPeople(otherDay, projectOnly), false);
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, personOnly), true);
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, both), true);
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, mismatch), false);
});

test("include keeps checked people and exclude drops them; no checks show everyone", () => {
  const include = {
    ...emptyProjectPeopleFilter(),
    phonebankers: ["Maria Lopez"],
    phonebankerMode: "include" as const,
  };
  const exclude = { ...include, phonebankerMode: "exclude" as const };
  const nobody = { ...emptyProjectPeopleFilter(), phonebankers: [], phonebankerMode: "exclude" as const };
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, include), true);
  assert.equal(pairMatchesProjectPeople(otherDay, include), false);
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, exclude), false);
  assert.equal(pairMatchesProjectPeople(otherDay, exclude), true);
  assert.equal(pairMatchesProjectPeople(phoneAndCanvass, nobody), true);
});

test("option lists follow the pairs passed in, including a date-scoped subset", () => {
  const all = projectPeopleOptions([phoneAndCanvass, otherDay]);
  assert.deepEqual(all.phoneBanks, ["Night Bank", "QC List A", "QC List B"]);
  assert.deepEqual(all.canvassProjects, ["Turf 4", "Turf 9"]);
  assert.ok(all.canvassers.includes("Nguyen, Dave"));
  assert.ok(all.canvassers.includes("Sam Door"));
  const scoped = projectPeopleOptions(filterPairsByQcDateRange([phoneAndCanvass, otherDay], "2026-10-19", "2026-10-19"));
  assert.deepEqual(scoped.phoneBanks, ["Night Bank", "QC List A"]);
  assert.deepEqual(scoped.canvassProjects, ["Turf 4"]);
  assert.deepEqual(scoped.qcCallers, ["Alex"]);
  assert.equal(scoped.canvassers.includes("Sam Door"), false);
});

test("listed selection can select all, clear, and invert the listed names", () => {
  assert.deepEqual(listedSelection(["Ann"], ["Ann", "Bo"], "all"), ["Ann", "Bo"]);
  assert.deepEqual(listedSelection(["Ann", "Cy"], ["Ann", "Bo"], "none"), ["Cy"]);
  assert.deepEqual(listedSelection(["Ann"], ["Ann", "Bo"], "invert"), ["Bo"]);
});

test("groups can be created, extended, and deleted", () => {
  const created = createActorGroup([], "Outreach", ["Dave Nguyen", "Dave Nguyen"], "g1");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.members, ["Dave Nguyen"]);
  assert.equal(createActorGroup(created, "  ", ["Sam"]).length, 1);
  const added = addMembersToActorGroup(created, "g1", ["Sam Door", "dave nguyen"]);
  assert.deepEqual(added[0]?.members, ["Dave Nguyen", "Sam Door"]);
  assert.equal(deleteActorGroup(added, "g1").length, 0);
  const parsed = parseActorGroups(JSON.stringify(created));
  assert.equal(parsed[0]?.name, "Outreach");
});
