import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPhonebankerOverviewCsv,
  summarizePhonebankerOverview,
  tallyPhonebankerOverview,
} from "./phonebanker-overview";
import type { PriorContactSummary, QcRecontactPair, RecontactCallSummary } from "./types";

function qcCall(overrides: Partial<RecontactCallSummary> = {}): RecontactCallSummary {
  return {
    callId: "qc-1",
    campaignId: "qc",
    campaignName: "QC",
    callDate: "2026-09-12",
    callAt: "2026-09-12T22:58:55.429Z",
    phonebankerName: "QC Caller",
    pdiId: "CA1",
    voterName: "Maria Botello",
    voterAddress: "1611 E 32Nd St",
    finalResultLabel: "Strong Support",
    pollingLabel: "Strong Support",
    canvassLabel: "Talking to Correct Person",
    contactedQuestion: "Were you contacted?",
    contactedAnswer: "A. Yes",
    notesAnswer: "",
    ...overrides,
  };
}

function prior(overrides: Partial<PriorContactSummary>): PriorContactSummary {
  return {
    channel: "phonebank",
    pdiId: "CA1",
    actorName: "Traci Henderson",
    occurredOn: "2026-09-05",
    listOrAssignment: "PB",
    resultLabel: "Strong Support",
    callAt: "2026-09-05T18:00:00",
    ...overrides,
  };
}

function pair(id: string, priors: PriorContactSummary[], qc?: Partial<RecontactCallSummary>): QcRecontactPair {
  return {
    pairId: id,
    qc: qcCall({ callId: id, pdiId: id, ...qc }),
    priors,
    matchStatus: priors.length ? "matched" : "unmatched",
    changeKind: "held",
  };
}

test("groups phonebank priors and merges name aliases", () => {
  const tally = tallyPhonebankerOverview([
    pair("a", [prior({ actorName: "traci", pdiId: "a" })], { pdiId: "a" }),
    pair("b", [prior({ actorName: "Traci Henderson", pdiId: "b" })], { pdiId: "b", voterName: "Jaime Marcelo" }),
  ]);
  assert.equal(tally.phonebankers.length, 1);
  const row = tally.phonebankers[0];
  assert.ok(row);
  assert.equal(row.phonebankerName, "Traci Henderson");
  assert.equal(row.surveyed, 2);
  assert.equal(row.contactedYes, 2);
  const csv = buildPhonebankerOverviewCsv(tally);
  assert.match(csv, /Phoned by,/);
  assert.match(csv, /Traci Henderson,2,/);
  assert.equal(summarizePhonebankerOverview(tally.phonebankers)?.phonebankerName, "Total");
});

test("canvass and text priors do not create a phonebanker row", () => {
  const tally = tallyPhonebankerOverview([
    pair("canvass", [prior({ channel: "canvass", actorName: "Dilan Davila" })]),
    pair("text", [prior({ channel: "text", actorName: "Tex Ter" })]),
  ]);
  assert.deepEqual(tally.phonebankers, []);
});
