import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignTag } from "../types";
import { mergeTextPriorsIntoPairs, textTagToResultLabel } from "./text";
import { pairMatchesChannelChip, recontactChannelLabel, resolvePhonebankPriors } from "./pair";
import { recontactPairsToCsvRows } from "./export";
import type { QcRecontactPair, QcTextContactSummary, RecontactCallSummary } from "./types";

const faizahTag: CampaignTag = {
  id: "faizah",
  label: "Faizah Malik",
  searchTerms: ["faizah", "malik"],
  color: "#4f46e5",
  textColor: "#ffffff",
  mode: "both",
};

const nithyaTag: CampaignTag = {
  id: "nithya",
  label: "Nithya Raman",
  searchTerms: ["nithya"],
  color: "#0d9488",
  textColor: "#ffffff",
  mode: "both",
};

function call(partial: Partial<RecontactCallSummary> & Pick<RecontactCallSummary, "callId" | "callDate">): RecontactCallSummary {
  return {
    campaignId: "c1",
    campaignName: "Faizah 001",
    callAt: `${partial.callDate}T12:00:00`,
    phonebankerName: "Alex",
    pdiId: "CA123",
    finalResultLabel: "Support Faizah",
    pollingLabel: "",
    canvassLabel: "",
    ...partial,
  };
}

function textContact(partial: Partial<QcTextContactSummary> & Pick<QcTextContactSummary, "campaignContactId" | "occurredOn">): QcTextContactSummary {
  return {
    campaignId: "txt-1",
    campaignName: "Faizah Text 001",
    pdiId: "CA1",
    texterName: "Sam",
    occurredAt: `${partial.occurredOn}T10:00:00`,
    resultLabel: "Strong Support",
    hasMessages: true,
    hasInboundReply: true,
    ...partial,
  };
}

test("textTagToResultLabel maps Nithya support tags and ignores Moved", () => {
  assert.equal(textTagToResultLabel("NithyaMayorYES", "nithya", "faizahTraci"), "Strong Support");
  assert.equal(textTagToResultLabel("NithyaMayor_SupportBass", "nithya", "faizahTraci"), "Strong Oppose");
  assert.equal(textTagToResultLabel("NithyaMayor_Neither", "nithya", "faizahTraci"), "Undecided");
  assert.equal(textTagToResultLabel("Moved2026", "nithya", "faizahTraci"), "");
});

test("textTagToResultLabel maps generic underscore support answers", () => {
  assert.equal(textTagToResultLabel("FaizahPitch_StrongSupport", "faizah", "faizahTraci"), "Strong Support");
});

test("pairs the latest text contact before the QC call", () => {
  const phone = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", callAt: "2026-03-10T18:00:00", pdiId: "CA1" })],
    [],
    "faizahTraci"
  );
  const merged = mergeTextPriorsIntoPairs(
    phone,
    faizahTag,
    [
      textContact({ campaignContactId: "t1", occurredOn: "2026-03-01", texterName: "Early" }),
      textContact({
        campaignContactId: "t2",
        occurredOn: "2026-03-08",
        occurredAt: "2026-03-08T15:00:00",
        texterName: "Later",
      }),
      textContact({
        campaignContactId: "t3",
        occurredOn: "2026-03-12",
        texterName: "After QC",
      }),
    ],
    "faizahTraci"
  );
  assert.equal(merged[0]?.matchStatus, "matched");
  assert.equal(merged[0]?.priors[0]?.channel, "text");
  assert.equal(merged[0]?.priors[0]?.actorName, "Later");
  assert.equal(merged[0]?.priors[0]?.campaignContactId, "t2");
  assert.equal(merged[0]?.priors[0]?.hasInboundReply, true);
  assert.equal(merged[0]?.changeKind, "held");
});

test("text prior copies hasInboundReply false for no-reply blasts", () => {
  const phone = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" })],
    [],
    "faizahTraci"
  );
  const merged = mergeTextPriorsIntoPairs(
    phone,
    faizahTag,
    [textContact({ campaignContactId: "t1", occurredOn: "2026-03-01", hasInboundReply: false, resultLabel: "" })],
    "faizahTraci"
  );
  assert.equal(merged[0]?.priors[0]?.hasInboundReply, false);
});

test("text after QC does not match", () => {
  const phone = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" })],
    [],
    "faizahTraci"
  );
  const merged = mergeTextPriorsIntoPairs(
    phone,
    faizahTag,
    [textContact({ campaignContactId: "t1", occurredOn: "2026-03-11" })],
    "faizahTraci"
  );
  assert.equal(merged[0]?.matchStatus, "unmatched");
  assert.equal(merged[0]?.priors.length, 0);
});

test("QC-named text campaigns are not priors", () => {
  const phone = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" })],
    [],
    "faizahTraci"
  );
  const merged = mergeTextPriorsIntoPairs(
    phone,
    faizahTag,
    [textContact({ campaignContactId: "t1", occurredOn: "2026-03-01", campaignName: "Faizah QC Text" })],
    "faizahTraci"
  );
  assert.equal(merged[0]?.priors.length, 0);
});

test("untagged newer text does not wipe a phone-bank change", () => {
  const phone = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", callAt: "2026-03-10T18:00:00", pdiId: "CA1" })],
    [
      call({
        callId: "r1",
        callDate: "2026-03-01",
        pdiId: "CA1",
        finalResultLabel: "Undecided",
      }),
    ],
    "faizahTraci"
  );
  assert.equal(phone[0]?.changeKind, "strengthened");
  const merged = mergeTextPriorsIntoPairs(
    phone,
    faizahTag,
    [
      textContact({
        campaignContactId: "t1",
        occurredOn: "2026-03-08",
        occurredAt: "2026-03-08T12:00:00",
        resultLabel: "",
        hasMessages: true,
      }),
    ],
    "faizahTraci"
  );
  assert.equal(merged[0]?.priors.length, 2);
  assert.equal(merged[0]?.priors[0]?.channel, "text");
  assert.equal(merged[0]?.changeKind, "strengthened");
});

test("text support vs QC oppose is flipped", () => {
  const phone = resolvePhonebankPriors(
    [
      call({
        callId: "qc1",
        callDate: "2026-03-10",
        pdiId: "CA1",
        finalResultLabel: "Support Traci",
      }),
    ],
    [],
    "faizahTraci"
  );
  const merged = mergeTextPriorsIntoPairs(
    phone,
    nithyaTag,
    [
      textContact({
        campaignContactId: "t1",
        occurredOn: "2026-03-01",
        campaignName: "Nithya PAC",
        resultLabel: "Strong Support",
      }),
    ],
    "faizahTraci"
  );
  assert.equal(merged[0]?.changeKind, "flipped");
});

test("pairMatchesChannelChip and channel label include Text", () => {
  const pair: QcRecontactPair = {
    pairId: "qc1",
    matchStatus: "matched",
    changeKind: "held",
    qc: call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" }),
    priors: [
      {
        channel: "text",
        pdiId: "CA1",
        actorName: "Sam",
        occurredOn: "2026-03-01",
        listOrAssignment: "Faizah Text 001",
        resultLabel: "Strong Support",
        campaignContactId: "t1",
      },
    ],
  };
  assert.equal(pairMatchesChannelChip(pair, "text"), true);
  assert.equal(pairMatchesChannelChip(pair, "phonebank"), false);
  assert.equal(recontactChannelLabel("text"), "Text");
});

test("recontact CSV writes Text as the prior channel", () => {
  const pair: QcRecontactPair = {
    pairId: "qc1",
    matchStatus: "matched",
    changeKind: "held",
    qc: call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" }),
    priors: [
      {
        channel: "text",
        pdiId: "CA1",
        actorName: "Sam",
        occurredOn: "2026-03-01",
        listOrAssignment: "Faizah Text 001",
        resultLabel: "Strong Support",
        callId: "t1",
        campaignContactId: "t1",
        callAt: "2026-03-01T10:00:00",
      },
    ],
  };
  const rows = recontactPairsToCsvRows([pair], "faizahTraci");
  assert.equal(rows[0]?.[12], "Text");
  assert.equal(rows[0]?.[16], "Sam");
  assert.equal(rows[0]?.[23], "Yes");
});
