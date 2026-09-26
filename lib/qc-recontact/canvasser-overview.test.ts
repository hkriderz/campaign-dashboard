import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanvasserOverviewCsv,
  formatOverviewPercent,
  tallyCanvasserOverview,
} from "./canvasser-overview";
import type { PriorContactSummary, QcRecontactPair, RecontactCallSummary } from "./types";

type Voter = {
  callId: string;
  originalFlag: string;
  originalDate: string;
  pdiId: string;
  voterName: string;
  address: string;
  contacted: string;
  polling: string;
  finalResult: string;
  caller: string;
  callDate: string;
  callAt: string;
};

const DILAN: Voter[] = [
  {
    callId: "maria",
    originalFlag: "Strong Support",
    originalDate: "2026-09-05",
    pdiId: "CA694046",
    voterName: "Maria Botello",
    address: "1611  E 32Nd St",
    contacted: "A. Yes",
    polling: "Strong Support for Nithya",
    finalResult: "Strong Support for Nithya",
    caller: "Sherryse McAleenan",
    callDate: "2026-09-12",
    callAt: "2026-09-12T22:58:55.429Z",
  },
  {
    callId: "jaime",
    originalFlag: "Strong Support",
    originalDate: "2026-09-13",
    pdiId: "CA40793250",
    voterName: "Jaime Marcelo",
    address: "1820   Canyon Dr  303",
    contacted: "A. Yes",
    polling: "A. Strong Support for Nithya",
    finalResult: "A. Strong Support for Nithya",
    caller: "Jonathan Fields",
    callDate: "2026-09-21",
    callAt: "2026-09-22T00:01:38.364Z",
  },
  {
    callId: "miguel",
    originalFlag: "Strong Support",
    originalDate: "2026-09-12",
    pdiId: "CA10447341",
    voterName: "Miguel Urbina-Chavez",
    address: "2371   Bullard Ave",
    contacted: "A. Yes",
    polling: "C. Strong Oppose",
    finalResult: "C. Strong Oppose",
    caller: "Vikas B",
    callDate: "2026-09-21",
    callAt: "2026-09-22T00:36:59.294Z",
  },
  {
    callId: "francisco",
    originalFlag: "Strong Support",
    originalDate: "2026-09-06",
    pdiId: "CA17505506",
    voterName: "Francisco Silva",
    address: "2626  E 1St St",
    contacted: "B. Unsure",
    polling: "B. Undecided",
    finalResult: "B. Undecided",
    caller: "Cynthia Solis",
    callDate: "2026-09-21",
    callAt: "2026-09-22T00:36:39.270Z",
  },
  {
    callId: "silvia",
    originalFlag: "Undecided",
    originalDate: "2026-09-06",
    pdiId: "CA38979916",
    voterName: "Silvia Lara",
    address: "2922   Pennsylvania Ave  6",
    contacted: "A. Yes",
    polling: "B. Undecided",
    finalResult: "A. Strong Support for Nithya",
    caller: "Cynthia Solis",
    callDate: "2026-09-21",
    callAt: "2026-09-22T00:40:29.436Z",
  },
  {
    callId: "esperanza",
    originalFlag: "Undecided",
    originalDate: "2026-09-06",
    pdiId: "CA5456838",
    voterName: "Esperanza Sandoval",
    address: "2917  E 1St St  306",
    contacted: "A. Yes",
    polling: "C. Strong Oppose",
    finalResult: "C. Strong Oppose",
    caller: "Ava",
    callDate: "2026-09-21",
    callAt: "2026-09-22T01:04:14.367Z",
  },
  {
    callId: "savannah",
    originalFlag: "Strong Support",
    originalDate: "2026-09-13",
    pdiId: "CA23927439",
    voterName: "Savannah Abrishamchian",
    address: "1738   Canyon Dr  214",
    contacted: "A. Yes",
    polling: "A. Strong Support for Nithya",
    finalResult: "A. Strong Support for Nithya",
    caller: "Tina m",
    callDate: "2026-09-21",
    callAt: "2026-09-22T02:21:12.372Z",
  },
  {
    callId: "victor",
    originalFlag: "Strong Support",
    originalDate: "2026-09-06",
    pdiId: "CA14069742",
    voterName: "Victor Lozano",
    address: "2917  E 1St St  411",
    contacted: "A. Yes",
    polling: "B. Undecided",
    finalResult: "B. Undecided",
    caller: "Vikas B",
    callDate: "2026-09-22",
    callAt: "2026-09-22T23:55:12.235Z",
  },
  {
    callId: "linda",
    originalFlag: "Strong Support",
    originalDate: "2026-09-08",
    pdiId: "CA10867531",
    voterName: "Linda Pineda",
    address: "2311  E 6Th St  1",
    contacted: "A. Yes",
    polling: "B. Undecided",
    finalResult: "B. Undecided",
    caller: "Ava",
    callDate: "2026-09-22",
    callAt: "2026-09-23T00:09:00.638Z",
  },
];

function qcCall(voter: Voter, canvassLabel = "Talking to Correct Person"): RecontactCallSummary {
  return {
    callId: voter.callId,
    campaignId: "qc-1",
    campaignName: "Nithya QC",
    callDate: voter.callDate,
    callAt: voter.callAt,
    phonebankerName: voter.caller,
    pdiId: voter.pdiId,
    voterName: voter.voterName,
    voterAddress: voter.address,
    finalResultLabel: voter.finalResult,
    pollingLabel: voter.polling,
    canvassLabel,
    contactedQuestion: "Were you contacted?",
    contactedAnswer: voter.contacted,
  };
}

function canvassPrior(voter: Voter, actorName = "Dilan Davila"): PriorContactSummary {
  return {
    channel: "canvass",
    pdiId: voter.pdiId,
    actorName,
    occurredOn: voter.originalDate,
    listOrAssignment: "Walk",
    resultLabel: voter.originalFlag,
    callAt: `${voter.originalDate}T18:00:00`,
  };
}

function pairFrom(voter: Voter, options?: { canvasser?: string; canvassLabel?: string; canvass?: boolean }): QcRecontactPair {
  const priors: PriorContactSummary[] = [];
  if (options?.canvass !== false) priors.push(canvassPrior(voter, options?.canvasser ?? "Dilan Davila"));
  return {
    pairId: voter.callId,
    qc: qcCall(voter, options?.canvassLabel),
    priors,
    matchStatus: priors.length ? "matched" : "unmatched",
    changeKind: "held",
  };
}

test("Dilan Davila summary matches the Detailed Canvasser View sheet", () => {
  const tally = tallyCanvasserOverview(DILAN.map((voter) => pairFrom(voter)));
  assert.equal(tally.canvassers.length, 1);
  const row = tally.canvassers[0];
  assert.ok(row);
  assert.equal(row.canvasserName, "Dilan Davila");
  assert.equal(row.surveyed, 9);
  assert.equal(row.originallyStrongSupport, 7);
  assert.equal(formatOverviewPercent(row.recallContactRate), "88.89%");
  assert.equal(formatOverviewPercent(row.strongSupportOnPollingRate), "42.86%");
  assert.equal(formatOverviewPercent(row.strongSupportAfterPersuasionRate), "42.86%");
  assert.equal(row.contactedYes, 8);
  assert.equal(row.contactedUnsure, 1);
  assert.equal(row.contactedNo, 0);
  assert.deepEqual(row.originalStrongSupportPolling, {
    surveyed: 7,
    strongSupport: 3,
    undecided: 3,
    strongOppose: 1,
  });
  assert.deepEqual(row.originalStrongSupportFinal, {
    surveyed: 7,
    strongSupport: 3,
    undecided: 3,
    strongOppose: 1,
  });
  assert.deepEqual(row.originalUndecidedFinal, {
    surveyed: 2,
    strongSupport: 1,
    undecided: 0,
    strongOppose: 1,
  });
  assert.equal(row.details.length, 9);
  const maria = row.details.find((detail) => detail.pdiId === "CA694046");
  assert.equal(maria?.voterFirstName, "Maria");
  assert.equal(maria?.voterLastName, "Botello");
  assert.equal(maria?.originalFlag, "Strong support");
  assert.equal(maria?.callTime, "22:58:55");

  const csv = buildCanvasserOverviewCsv(tally);
  assert.match(csv, /Dilan Davila,9,7,88\.89%,42\.86%,42\.86%,8,1,0,7,3,3,1,7,3,3,1,2,1,0,1/);
  assert.match(csv, /Maria,Botello/);
});

test("zero originally strong support keeps percents at 0", () => {
  const voter = DILAN[4];
  assert.ok(voter);
  const tally = tallyCanvasserOverview([pairFrom(voter, { canvasser: "Solo Lane" })]);
  const row = tally.canvassers[0];
  assert.ok(row);
  assert.equal(row.surveyed, 1);
  assert.equal(row.originallyStrongSupport, 0);
  assert.equal(row.strongSupportOnPollingRate, 0);
  assert.equal(row.strongSupportAfterPersuasionRate, 0);
  assert.equal(formatOverviewPercent(row.strongSupportOnPollingRate), "0.00%");
  assert.equal(row.originalUndecidedFinal.surveyed, 1);
  assert.equal(row.originalUndecidedFinal.strongSupport, 1);
  assert.equal(Number.isNaN(row.strongSupportOnPollingRate), false);
});

test("pairs without a canvass prior are excluded", () => {
  const voter = DILAN[0];
  assert.ok(voter);
  const phoneOnly: QcRecontactPair = {
    ...pairFrom(voter, { canvass: false }),
    priors: [
      {
        channel: "phonebank",
        pdiId: voter.pdiId,
        actorName: "Phone Pat",
        occurredOn: "2026-09-01",
        listOrAssignment: "PB",
        resultLabel: "Strong Support",
      },
    ],
    matchStatus: "matched",
  };
  const notUseful = pairFrom(voter, { canvassLabel: "" });
  const tally = tallyCanvasserOverview([phoneOnly, notUseful]);
  assert.deepEqual(tally.canvassers, []);
});
