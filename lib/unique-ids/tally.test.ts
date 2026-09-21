import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignTag } from "../types";
import type { KnockIndexTallyRow } from "../canvassing/overview-tally";
import type { QcTextContactSummary, RecontactCallSummary } from "../qc-recontact/types";
import { familyFromKnockOutcome, familyFromResultLabel } from "./classify";
import { collectKnockEvents, collectPhoneEvents, collectTextEvents } from "./collect";
import { tallyUniqueIds } from "./tally";
import type { UniqueIdContactEvent } from "./types";

const nithyaTag: CampaignTag = {
  id: "nithya",
  label: "Nithya Raman",
  searchTerms: ["nithya"],
  color: "#0d9488",
  textColor: "#ffffff",
  mode: "both",
};

function event(
  partial: Partial<UniqueIdContactEvent> & Pick<UniqueIdContactEvent, "personId" | "family" | "occurredOn">
): UniqueIdContactEvent {
  return {
    occurredAt: `${partial.occurredOn}T12:00:00`,
    channel: "phone",
    campaignName: "Nithya 001",
    actorName: "Alex",
    ...partial,
  };
}

function call(
  partial: Partial<RecontactCallSummary> & Pick<RecontactCallSummary, "callId" | "pdiId" | "finalResultLabel">
): RecontactCallSummary {
  return {
    campaignId: "c1",
    campaignName: "Nithya Eng 9-5",
    callDate: "2026-09-05",
    callAt: "2026-09-05T12:00:00",
    phonebankerName: "Alex",
    pollingLabel: "",
    canvassLabel: "",
    ...partial,
  };
}

function text(
  partial: Partial<QcTextContactSummary> & Pick<QcTextContactSummary, "pdiId" | "resultLabel">
): QcTextContactSummary {
  return {
    campaignContactId: "t1",
    campaignId: "tc1",
    campaignName: "Nithya Text 001",
    texterName: "Jordan",
    occurredOn: "2026-09-06",
    occurredAt: "2026-09-06T15:00:00",
    hasMessages: true,
    hasInboundReply: true,
    ...partial,
  };
}

function knock(
  partial: Partial<KnockIndexTallyRow> & Pick<KnockIndexTallyRow, "primaryId" | "occurredAt">
): KnockIndexTallyRow {
  return {
    canvasserName: "Sam Door",
    assignmentName: "Nithya Eng 9-5-26",
    question: "Can we count on you to support Nithya Raman for mayor?",
    response: "Strong Support",
    ...partial,
  };
}

test("familyFromResultLabel maps Neither and knock support into SS/U/SO", () => {
  assert.equal(familyFromResultLabel("Neither", "faizahTraci"), "undecided");
  assert.equal(familyFromResultLabel("Strong Support", "faizahTraci"), "strongSupport");
  assert.equal(familyFromResultLabel("Support Nithya", "faizahTraci"), "strongSupport");
  assert.equal(familyFromResultLabel("Strong Oppose", "faizahTraci"), "strongOppose");
  assert.equal(familyFromResultLabel("Not Home", "faizahTraci"), null);
  assert.equal(familyFromKnockOutcome("support"), "strongSupport");
  assert.equal(familyFromKnockOutcome("oppose"), "strongOppose");
});

test("tally skips punctuation-only person IDs", () => {
  const tally = tallyUniqueIds([
    event({ personId: "-", family: "strongSupport", occurredOn: "2026-09-08" }),
    event({ personId: "CA1", family: "undecided", occurredOn: "2026-09-08" }),
  ]);
  assert.equal(tally.combined.uniqueIds, 1);
  assert.equal(tally.matchedRows[0]?.personId, "CA1");
});

test("collect drops missing IDs, QC lists, and non-support labels", () => {
  const phone = collectPhoneEvents(
    [
      call({ callId: "1", pdiId: "ca 1", finalResultLabel: "Support Nithya" }),
      call({ callId: "2", pdiId: "", finalResultLabel: "Support Nithya" }),
      call({
        callId: "3",
        pdiId: "CA2",
        campaignName: "Nithya QC 001",
        finalResultLabel: "Support Nithya",
      }),
      call({ callId: "4", pdiId: "CA3", finalResultLabel: "Wrong Number" }),
    ],
    "faizahTraci"
  );
  assert.deepEqual(
    phone.map((row) => row.personId),
    ["CA1"]
  );

  const texts = collectTextEvents(
    [
      text({ pdiId: "ca1", resultLabel: "Neither" }),
      text({ pdiId: "  ", resultLabel: "Strong Support" }),
      text({ pdiId: "CA9", campaignName: "QC Nithya Text", resultLabel: "Strong Support" }),
    ],
    "faizahTraci"
  );
  assert.equal(texts.length, 1);
  assert.equal(texts[0]?.family, "undecided");
});

test("knock support folds into Strong support and ignores donate rows", () => {
  const events = collectKnockEvents(
    [
      knock({
        primaryId: "ca1",
        occurredAt: "2026-09-05T14:00:00.000-07:00",
        response: "Support",
      }),
      knock({
        primaryId: "CA1",
        occurredAt: "2026-09-05T15:00:00.000-07:00",
        question: "Would you like to donate to Nithya?",
        response: "Yes",
      }),
      knock({
        primaryId: "CA2",
        occurredAt: "2026-09-06T11:00:00.000-07:00",
        assignmentName: "Faizah Turf A",
        response: "Undecided",
      }),
    ],
    { tag: nithyaTag }
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.personId, "CA1");
  assert.equal(events[0]?.family, "strongSupport");
});

test("latest label wins across days and channels; channel breakout stays separate", () => {
  const tally = tallyUniqueIds([
    event({ personId: "CA1", family: "undecided", occurredOn: "2026-09-01", channel: "phone" }),
    event({
      personId: "CA1",
      family: "strongSupport",
      occurredOn: "2026-09-05",
      occurredAt: "2026-09-05T18:00:00",
      channel: "text",
    }),
    event({
      personId: "CA1",
      family: "undecided",
      occurredOn: "2026-09-05",
      occurredAt: "2026-09-05T12:00:00",
      channel: "canvass",
    }),
    event({ personId: "CA2", family: "strongOppose", occurredOn: "2026-09-02", channel: "phone" }),
  ]);

  assert.equal(tally.combined.uniqueIds, 2);
  assert.equal(tally.combined.strongSupport, 1);
  assert.equal(tally.combined.strongOppose, 1);
  assert.equal(tally.byChannel.phone.undecided, 1);
  assert.equal(tally.byChannel.phone.strongOppose, 1);
  assert.equal(tally.byChannel.text.strongSupport, 1);
  assert.equal(tally.byChannel.canvass.undecided, 1);
  assert.equal(tally.changes.changed, 1);
  assert.equal(tally.changes.held, 1);
  assert.equal(tally.changes.transitions[0]?.from, "undecided");
  assert.equal(tally.changes.transitions[0]?.to, "strongSupport");
  assert.deepEqual(tally.changes.transitions[0]?.personIds, ["CA1"]);
  assert.equal(tally.changes.people[0]?.personId, "CA1");
  assert.equal(tally.changes.people[0]?.events.length, 3);

  const ca1 = tally.matchedRows.find((row) => row.personId === "CA1");
  assert.equal(ca1?.family, "strongSupport");
  assert.equal(ca1?.channel, "text");
  assert.equal(ca1?.priorFamily, "undecided");
  assert.deepEqual(ca1?.channels, ["phone", "text", "canvass"]);
});

test("same-timestamp tie-break prefers canvass over phone over text", () => {
  const stamp = "2026-09-08T12:00:00";
  const tally = tallyUniqueIds([
    event({
      personId: "CA1",
      family: "strongOppose",
      occurredOn: "2026-09-08",
      occurredAt: stamp,
      channel: "text",
    }),
    event({
      personId: "CA1",
      family: "strongSupport",
      occurredOn: "2026-09-08",
      occurredAt: stamp,
      channel: "canvass",
    }),
    event({
      personId: "CA1",
      family: "undecided",
      occurredOn: "2026-09-08",
      occurredAt: stamp,
      channel: "phone",
    }),
  ]);
  assert.equal(tally.combined.strongSupport, 1);
  assert.equal(tally.matchedRows[0]?.channel, "canvass");
});

test("date filter and ID search apply after unique collapse", () => {
  const tally = tallyUniqueIds(
    [
      event({ personId: "CA1", family: "undecided", occurredOn: "2026-09-01", channel: "phone" }),
      event({ personId: "CA1", family: "strongSupport", occurredOn: "2026-09-10", channel: "phone" }),
      event({ personId: "CA9", family: "undecided", occurredOn: "2026-09-05", channel: "text" }),
    ],
    { startDate: "2026-09-05", endDate: "2026-09-12", q: "ca1" }
  );
  assert.equal(tally.combined.uniqueIds, 2);
  assert.equal(tally.combined.strongSupport, 1);
  assert.equal(tally.ids.total, 1);
  assert.equal(tally.ids.rows[0]?.personId, "CA1");
  assert.equal(tally.ids.rows[0]?.changed, false);
  assert.equal(tally.minDate, "2026-09-01");
  assert.equal(tally.maxDate, "2026-09-10");
});
