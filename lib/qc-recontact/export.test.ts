import test from "node:test";
import assert from "node:assert/strict";
import { buildRecontactPairsCsv, recontactExportFilename, recontactPairsToCsvRows } from "./export";
import type { QcRecontactPair } from "./types";

const matched: QcRecontactPair = {
  pairId: "qc-1",
  matchStatus: "matched",
  changeKind: "flipped",
  qc: {
    callId: "qc-1",
    campaignId: "camp-qc",
    campaignName: "Nithya QC PB 9.12",
    callDate: "2026-09-12",
    callAt: "2026-09-12T18:05:00",
    phonebankerName: "Ava",
    pdiId: "PDI123",
    voterName: "Ada Lovelace",
    voterAddress: "1 Main St, Los Angeles, CA 90001",
    finalResultLabel: "Strong Oppose",
    pollingLabel: "Undecided",
    canvassLabel: "Talking to Correct Person",
    contactedQuestion: "Were you contacted?",
    contactedAnswer: "Yes",
  },
  priors: [
    {
      channel: "phonebank",
      pdiId: "PDI123",
      actorName: "Sidney",
      occurredOn: "2026-09-09",
      listOrAssignment: "Nithya PB 9.9",
      resultLabel: "Strong Support for Nithya",
      callId: "pb-1",
      campaignId: "camp-pb",
      callAt: "2026-09-09T16:00:00",
      finalResultLabel: "Strong Support for Nithya",
      pollingLabel: "Strong Support for Nithya",
      canvassLabel: "",
    },
    {
      channel: "canvass",
      pdiId: "PDI123",
      actorName: "Jose",
      occurredOn: "2026-09-08",
      listOrAssignment: "Nithya Turf A",
      resultLabel: "Strong support",
    },
  ],
};

const unmatched: QcRecontactPair = {
  pairId: "qc-2",
  matchStatus: "unmatched",
  changeKind: "unknown",
  qc: {
    callId: "qc-2",
    campaignId: "camp-qc",
    campaignName: "Nithya QC PB 9.12",
    callDate: "2026-09-12",
    callAt: "",
    phonebankerName: "Ed",
    pdiId: "PDI999",
    voterName: "",
    voterAddress: "",
    finalResultLabel: "Undecided",
    pollingLabel: "",
    canvassLabel: "",
    contactedQuestion: "",
    contactedAnswer: "",
  },
  priors: [],
};

test("recontact CSV remaps candidate result labels to generic SS / U / SO", () => {
  const rows = recontactPairsToCsvRows([matched], "faizahTraci");
  const resultCells = [rows[0]?.[12], rows[0]?.[13], rows[0]?.[20], rows[0]?.[21], rows[0]?.[22]].join("|");
  assert.equal(rows[0]?.[5], "Yes");
  assert.equal(rows[0]?.[12], "Strong oppose");
  assert.equal(rows[0]?.[20], "Strong support");
  assert.equal(rows[0]?.[21], "Strong support");
  assert.doesNotMatch(resultCells, /faizah|nithya/i);
});

test("recontact CSV is one row per prior and keeps unmatched QC calls", () => {
  const rows = recontactPairsToCsvRows([matched, unmatched]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.[0], "Flipped");
  assert.equal(rows[0]?.[2], "PDI123");
  assert.equal(rows[0]?.[3], "Ada Lovelace");
  assert.equal(rows[0]?.[4], "1 Main St, Los Angeles, CA 90001");
  assert.equal(rows[0]?.[15], "Phone bank");
  assert.equal(rows[0]?.[26], "Yes");
  assert.equal(rows[1]?.[15], "Canvass");
  assert.equal(rows[1]?.[26], "No");
  assert.equal(rows[2]?.[1], "Unmatched");
  assert.equal(rows[2]?.[15], "");
});

test("buildRecontactPairsCsv includes a header and escaped cells", () => {
  const csv = buildRecontactPairsCsv([unmatched]);
  assert.match(csv, /^Change,Match status,PDI,/);
  assert.match(csv, /Unmatched,PDI999,/);
  assert.equal(recontactExportFilename("qc-nithya", [unmatched]), "recontacts-qc-nithya-2026-09-12.csv");
});
