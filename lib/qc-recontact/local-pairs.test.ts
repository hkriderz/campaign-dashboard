import assert from "node:assert/strict";
import test from "node:test";
import { resolveSurveyScriptProfile } from "../campaign-tags";
import { groupRowsIntoCallSummaries } from "../queries/qc-recontact";
import type { UniqueIdContactEvent } from "../unique-ids/types";
import { familyFromResultLabel } from "../unique-ids/classify";
import { candidateTermsForTag } from "../strong-support-from-survey";
import { getTagById } from "../campaign-tags";
import { resolvePhonebankPriors } from "./pair";
import { mergeUniqueIdPhoneEvents, rowsFromUniqueIdEvents, stampPdiFromUniqueIdEvents } from "./local-pairs";
import type { PdiSurveyRow } from "../queries/qc-recontact";

const profile = resolveSurveyScriptProfile(getTagById("qc-nithya")!);
const terms = candidateTermsForTag(getTagById("nithya")!);

function phoneEvent(overrides: Partial<UniqueIdContactEvent>): UniqueIdContactEvent {
  return {
    personId: "CA1",
    occurredAt: "2026-10-11T18:00:00",
    occurredOn: "2026-10-11",
    channel: "phone",
    family: "strongSupport",
    campaignName: "Nithya QC 010",
    actorName: "Ava",
    voterName: "Pat Voter",
    ...overrides,
  };
}

test("a survey call with no PDI id takes the one Unique ID on that campaign day", () => {
  const rows: PdiSurveyRow[] = [
    {
      callId: "call-1",
      campaignId: "camp",
      campaignName: "Nithya QC 010",
      callDate: "2026-10-11",
      callAt: "",
      phonebankerName: "Ava",
      pdiId: "",
      voterName: "",
      voterAddress: "",
      questionName: "Final Result",
      answerValue: "Strong support",
    },
  ];
  const stamped = stampPdiFromUniqueIdEvents(rows, [phoneEvent({})], profile, terms);
  assert.equal(stamped[0]?.pdiId, "CA1");
  assert.equal(stamped[0]?.voterName, "Pat Voter");
});

test("a Unique ID flag becomes a QC call matched to the earlier phonebank flag", () => {
  const qc = groupRowsIntoCallSummaries(
    rowsFromUniqueIdEvents([phoneEvent({ occurredOn: "2026-10-11", occurredAt: "2026-10-11T18:00:00" })]),
    profile,
    terms
  );
  const prior = groupRowsIntoCallSummaries(
    rowsFromUniqueIdEvents([
      phoneEvent({
        campaignName: "Nithya PB 9.14",
        occurredOn: "2026-09-14",
        occurredAt: "2026-09-14T15:00:00",
        family: "undecided",
      }),
    ]),
    profile,
    terms
  );
  assert.equal(familyFromResultLabel(qc[0]?.finalResultLabel ?? "", profile), "strongSupport");
  assert.equal(qc[0]?.canvassLabel, "Talking to Correct Person");
  const pairs = resolvePhonebankPriors(qc, prior, profile);
  assert.equal(pairs[0]?.matchStatus, "matched");
  assert.equal(familyFromResultLabel(pairs[0]?.priors[0]?.resultLabel ?? "", profile), "undecided");
  assert.equal(pairs[0]?.changeKind, "strengthened");
});

test("a saved Unique ID flag stays when the survey rows do not cover it", () => {
  const kept = phoneEvent({ personId: "CA9", campaignName: "Nithya QC 009", occurredOn: "2026-10-09" });
  const replaced = phoneEvent({ personId: "CA1", family: "undecided" });
  const fresh = phoneEvent({ personId: "CA1", family: "strongSupport" });
  const merged = mergeUniqueIdPhoneEvents([fresh], [replaced, kept]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((event) => event.personId === "CA1")?.family, "strongSupport");
  assert.equal(merged.find((event) => event.personId === "CA9")?.campaignName, "Nithya QC 009");
});
