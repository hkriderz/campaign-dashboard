import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { saveRecontactPairsSnapshot } from "../bq-snapshot-store";
import { resolveSurveyScriptProfile } from "../campaign-tags";
import { groupRowsIntoCallSummaries } from "../queries/qc-recontact";
import type { UniqueIdContactEvent } from "../unique-ids/types";
import { familyFromResultLabel } from "../unique-ids/classify";
import { candidateTermsForTag } from "../strong-support-from-survey";
import { getTagById } from "../campaign-tags";
import { resolvePhonebankPriors } from "./pair";
import {
  buildQcRecontactPairsFromLocalFiles,
  clearLocalPairCacheForTests,
  localPairCachePeekForTests,
  mergeSurveyRows,
  mergeUniqueIdPhoneEvents,
  qcPairSourceStamp,
  recontactPairsStampIsCurrent,
  rowsFromUniqueIdEvents,
  stampPdiFromUniqueIdEvents,
  syncQcAnalysisFromLocalFiles,
  warmQcPairCachesFromDisk,
} from "./local-pairs";
import { applySavedCalleeIdentity, calleeIdSqlLiteral, calleeIdentityIsComplete, isLookupCalleeId } from "../queries/qc-recontact";
import type { PdiSurveyRow } from "../queries/qc-recontact";
import type { CallSurveyRowForFill } from "../types";
import type { QcRecontactPair } from "./types";

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

test("callee lookup accepts the UUID stored on a QC call", () => {
  const id = "01a12de7-b2ce-7688-8447-894c140189ed";
  assert.equal(isLookupCalleeId(id), true);
  assert.equal(calleeIdSqlLiteral(id), `'${id}'`);
  assert.equal(isLookupCalleeId("12345"), true);
  assert.equal(calleeIdSqlLiteral("12345"), "12345");
  assert.equal(isLookupCalleeId("'); drop table callees; --"), false);
});

test("a saved callee record fills a blank PDI id, name, and address", () => {
  const row: CallSurveyRowForFill = {
    callId: "call-1",
    campaignId: "camp",
    campaignName: "Nithya QC 010",
    callDate: "2026-10-12",
    phonebankerName: "Vikas B",
    questionName: "Final Result",
    answerValue: "Strong support",
    surveyResultId: 1,
    calleeId: "42",
  };
  const stamped = applySavedCalleeIdentity(row, {
    pdiId: "ca 9",
    voterName: "Ada Lovelace",
    voterAddress: "1 Main St",
  });
  assert.equal(stamped.pdiId, "CA9");
  assert.equal(stamped.voterName, "Ada Lovelace");
  assert.equal(stamped.voterAddress, "1 Main St");
  assert.equal(calleeIdentityIsComplete({ pdiId: "CA9", voterName: "Ada", voterAddress: "" }), false);
  assert.equal(
    calleeIdentityIsComplete({ pdiId: "CA9", voterName: "Ada", voterAddress: "", addressChecked: true }),
    true
  );
});

test("dialer rows supply the PDI id and address the survey file left blank", () => {
  const survey = {
    callId: "call-1",
    campaignId: "camp",
    campaignName: "Nithya QC 010",
    callDate: "2026-10-12",
    callAt: "",
    phonebankerName: "Vikas B",
    pdiId: "",
    voterName: "",
    voterAddress: "",
    questionName: "Final Result",
    answerValue: "Strong support",
  };
  const dialer = { ...survey, pdiId: "CA9", voterName: "Ada Lovelace", voterAddress: "1 Main St" };
  const merged = mergeSurveyRows([survey], [dialer]);
  assert.equal(merged[0]?.pdiId, "CA9");
  assert.equal(merged[0]?.voterName, "Ada Lovelace");
  assert.equal(merged[0]?.voterAddress, "1 Main St");
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

test("recontactPairsStampIsCurrent requires an exact stored stamp", () => {
  assert.equal(recontactPairsStampIsCurrent({ sourceStamp: "a|b" }, "a|b"), true);
  assert.equal(recontactPairsStampIsCurrent({ sourceStamp: "a|b" }, "a|c"), false);
  assert.equal(recontactPairsStampIsCurrent({}, "a|b"), false);
  assert.equal(recontactPairsStampIsCurrent(null, "a|b"), false);
  assert.equal(recontactPairsStampIsCurrent(undefined, "a|b"), false);
});

function sentinelPair(pairId: string): QcRecontactPair {
  return {
    pairId,
    qc: {
      callId: pairId,
      campaignId: "camp",
      campaignName: "Nithya QC stamp-test",
      callDate: "2026-10-11",
      callAt: "",
      phonebankerName: "Ava",
      pdiId: "CA1",
      voterName: "Pat",
      voterAddress: "1 Main",
      finalResultLabel: "Strong support",
      pollingLabel: "",
      canvassLabel: "",
      contactedQuestion: "",
      contactedAnswer: "",
      notesAnswer: "",
    },
    priors: [],
    matchStatus: "unmatched",
    changeKind: "unknown",
  };
}

test("matching sourceStamp serves pairs, seeds memory, and warm restores after clear", async () => {
  const qcTagId = "qc-nithya";
  const primaryId = "nithya";
  const fp = path.join(process.cwd(), "data", "bq-snapshots", qcTagId, "recontact-pairs.json");
  if (!fs.existsSync(fp)) return;

  const original = fs.readFileSync(fp, "utf8");
  try {
    clearLocalPairCacheForTests();
    const stamp = qcPairSourceStamp(qcTagId, primaryId);
    const sentinel = [sentinelPair("stamp-serve-test")];
    saveRecontactPairsSnapshot(qcTagId, sentinel, {
      touchEvenIfUnchanged: true,
      sourceStamp: stamp,
    });
    clearLocalPairCacheForTests();

    const pairs = await buildQcRecontactPairsFromLocalFiles(qcTagId);
    assert.equal(pairs?.length, 1);
    assert.equal(pairs?.[0]?.pairId, "stamp-serve-test");
    assert.equal(localPairCachePeekForTests(qcTagId)?.stamp, stamp);
    assert.equal(localPairCachePeekForTests(qcTagId)?.pairCount, 1);

    const again = await buildQcRecontactPairsFromLocalFiles(qcTagId);
    assert.equal(again?.[0]?.pairId, "stamp-serve-test");

    clearLocalPairCacheForTests();
    assert.equal(localPairCachePeekForTests(qcTagId), null);
    warmQcPairCachesFromDisk();
    assert.equal(localPairCachePeekForTests(qcTagId)?.stamp, stamp);
    assert.equal(localPairCachePeekForTests(qcTagId)?.pairCount, 1);
  } finally {
    fs.writeFileSync(fp, original, "utf8");
    clearLocalPairCacheForTests();
  }
});

test("stale sourceStamp is not served from disk and warm skips it", async () => {
  const qcTagId = "qc-nithya";
  const primaryId = "nithya";
  const fp = path.join(process.cwd(), "data", "bq-snapshots", qcTagId, "recontact-pairs.json");
  if (!fs.existsSync(fp)) return;

  const original = fs.readFileSync(fp, "utf8");
  try {
    clearLocalPairCacheForTests();
    saveRecontactPairsSnapshot(qcTagId, [sentinelPair("stale-stamp-test")], {
      touchEvenIfUnchanged: true,
      sourceStamp: "stale-not-current",
    });
    clearLocalPairCacheForTests();

    assert.equal(
      recontactPairsStampIsCurrent({ sourceStamp: "stale-not-current" }, qcPairSourceStamp(qcTagId, primaryId)),
      false
    );

    warmQcPairCachesFromDisk();
    assert.equal(localPairCachePeekForTests(qcTagId), null);

    // Rebuild from dumps (or null if dumps are missing). Must not return the stale sentinel.
    const pairs = await buildQcRecontactPairsFromLocalFiles(qcTagId);
    if (pairs) {
      assert.notEqual(pairs[0]?.pairId, "stale-stamp-test");
      const peek = localPairCachePeekForTests(qcTagId);
      assert.ok(peek);
      assert.equal(peek.stamp, qcPairSourceStamp(qcTagId, primaryId));
    }
  } finally {
    fs.writeFileSync(fp, original, "utf8");
    clearLocalPairCacheForTests();
  }
});

test("syncQcAnalysisFromLocalFiles leaves the pair cache warm", async () => {
  const qcTagId = "qc-nithya";
  const fillPath = path.join(process.cwd(), "data", "bq-snapshots", qcTagId, "call-survey-fill.json");
  if (!fs.existsSync(fillPath)) return;

  clearLocalPairCacheForTests();
  await syncQcAnalysisFromLocalFiles(qcTagId);
  const peek = localPairCachePeekForTests(qcTagId);
  assert.ok(peek);
  assert.equal(peek.stamp, qcPairSourceStamp(qcTagId, "nithya"));
  assert.ok(peek.pairCount > 0);
  clearLocalPairCacheForTests();
});
