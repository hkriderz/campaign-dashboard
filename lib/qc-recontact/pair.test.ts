import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignTag } from "../types";
import { resolveSurveyScriptProfile } from "../campaign-tags";
import { classifyRecontactChange } from "./change";
import { callOccurredBefore, matchesPdiOrNameQuery, normalizeRecontactPersonId } from "./ids";
import { extractCallSurveyLabels, fillMissingCanvassLabel, isWereYouContactedQuestion, surveyRowIsTalkingToCorrectPerson } from "./labels";
import {
  knockIsQcSupportChecker,
  knockMatchesPrimaryTag,
  mergeCanvassPriorsIntoPairs,
  replaceCanvassPriorsFromKnockIndex,
  resolveCanvassPriors,
} from "./canvass";
import {
  emptyRecontactSelection,
  pairHasQcContact,
  pairIsUsefulRecontact,
  pairMatchesPriorActor,
  pairMatchesQcCaller,
  priorActorNamesForPairs,
  qcCallerNamesForPairs,
  pairMatchesChannelChip,
  pairMatchesSelections,
  pairWithSupportAnswers,
  resolvePhonebankPriors,
  summarizeRecontactPairs,
} from "./pair";
import type { QcCanvassKnockIndexRow, QcRecontactPair, RecontactCallSummary } from "./types";

const faizahTag: CampaignTag = {
  id: "faizah",
  label: "Faizah Malik",
  searchTerms: ["faizah", "malik"],
  color: "#4f46e5",
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
    voterName: "",
    voterAddress: "",
    finalResultLabel: "Support Faizah",
    pollingLabel: "",
    canvassLabel: "",
    contactedQuestion: "",
    contactedAnswer: "",
    ...partial,
  };
}

test("normalizeRecontactPersonId treats PDI and PRIMARYID the same", () => {
  assert.equal(normalizeRecontactPersonId(" ca 123 "), "CA123");
  assert.equal(normalizeRecontactPersonId("CA123"), normalizeRecontactPersonId("ca123"));
});

test("pairs the latest regular call before the QC date", () => {
  const qc = [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1", phonebankerName: "QC Pat" })];
  const primary = [
    call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1", phonebankerName: "Maria", finalResultLabel: "Undecided" }),
    call({ callId: "r2", callDate: "2026-03-05", pdiId: "CA1", phonebankerName: "James", finalResultLabel: "Support Faizah" }),
    call({ callId: "r3", callDate: "2026-03-12", pdiId: "CA1", phonebankerName: "Later", finalResultLabel: "Support Traci" }),
  ];
  const pairs = resolvePhonebankPriors(qc, primary, "faizahTraci");
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.matchStatus, "matched");
  assert.equal(pairs[0]?.priors[0]?.actorName, "James");
  assert.equal(pairs[0]?.priors[0]?.channel, "phonebank");
  assert.equal(pairs[0]?.priors[0]?.callId, "r2");
  assert.equal(pairs[0]?.changeKind, "held");
});

test("skips a newer non-result call and a newer QC list for the earlier support call", () => {
  const pairs = resolvePhonebankPriors(
    [
      call({
        callId: "qc1",
        callDate: "2026-09-26",
        pdiId: "CA44794595",
        campaignName: "9.26 Nithya QC PB",
        finalResultLabel: "Undecided",
      }),
    ],
    [
      call({
        callId: "r-support",
        callDate: "2026-09-09",
        pdiId: "CA44794595",
        phonebankerName: "Sept Nine",
        campaignName: "Nithya PB 9.9 Revocation Signers",
        finalResultLabel: "Support Nithya",
      }),
      call({
        callId: "r-blank",
        callDate: "2026-09-20",
        pdiId: "CA44794595",
        phonebankerName: "Later Blank",
        campaignName: "Nithya PB 9.20",
        finalResultLabel: "Wrong Number",
      }),
      call({
        callId: "r-qc",
        callDate: "2026-09-22",
        pdiId: "CA44794595",
        phonebankerName: "Earlier QC",
        campaignName: "9.22 Nithya QC PB",
        finalResultLabel: "Undecided",
      }),
    ],
    "faizahTraci"
  );
  assert.equal(pairs[0]?.matchStatus, "matched");
  assert.equal(pairs[0]?.priors[0]?.callId, "r-support");
  assert.equal(pairs[0]?.priors[0]?.actorName, "Sept Nine");
  assert.equal(pairs[0]?.changeKind, "softened");
});

test("regular call after QC does not match", () => {
  const pairs = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" })],
    [call({ callId: "r1", callDate: "2026-03-11", pdiId: "CA1" })],
    "faizahTraci"
  );
  assert.equal(pairs[0]?.matchStatus, "unmatched");
  assert.equal(pairs[0]?.priors.length, 0);
});

test("same-day earlier phone bank still matches when callAt is present", () => {
  const pairs = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", callAt: "2026-03-10T18:00:00", pdiId: "CA1" })],
    [call({ callId: "r1", callDate: "2026-03-10", callAt: "2026-03-10T11:00:00", pdiId: "CA1", phonebankerName: "Morning" })],
    "faizahTraci"
  );
  assert.equal(pairs[0]?.matchStatus, "matched");
  assert.equal(pairs[0]?.priors[0]?.actorName, "Morning");
});

test("missing PDI is its own status", () => {
  const pairs = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "  " })],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1" })],
    "faizahTraci"
  );
  assert.equal(pairs[0]?.matchStatus, "no_pdi");
});

test("pairHasQcContact requires talking to the correct person, not merely a Final Result", () => {
  const reached = resolvePhonebankPriors(
    [
      call({
        callId: "qc1",
        callDate: "2026-03-10",
        pdiId: "CA1",
        finalResultLabel: "",
        canvassLabel: "Talking to Correct Person",
      }),
    ],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1" })],
    "faizahTraci"
  )[0]!;
  const notHome = resolvePhonebankPriors(
    [
      call({
        callId: "qc2",
        callDate: "2026-03-10",
        pdiId: "CA1",
        finalResultLabel: "Support Faizah",
        canvassLabel: "Not Home",
      }),
    ],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1" })],
    "faizahTraci"
  )[0]!;
  const noCanvass = resolvePhonebankPriors(
    [call({ callId: "qc3", callDate: "2026-03-10", pdiId: "CA1", finalResultLabel: "Support Faizah" })],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1" })],
    "faizahTraci"
  )[0]!;
  const legacyYes = resolvePhonebankPriors(
    [
      call({
        callId: "qc4",
        callDate: "2026-03-10",
        pdiId: "CA1",
        canvassLabel: "Yes",
      }),
    ],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1" })],
    "faizahTraci"
  )[0]!;
  assert.equal(pairHasQcContact(reached), true);
  assert.equal(pairHasQcContact(notHome), false);
  assert.equal(pairHasQcContact(noCanvass), false);
  assert.equal(pairHasQcContact(legacyYes), true);
});

test("multiple QC calls to the same PDI each get a row", () => {
  const pairs = resolvePhonebankPriors(
    [
      call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" }),
      call({ callId: "qc2", callDate: "2026-03-20", pdiId: "CA1" }),
    ],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1", phonebankerName: "Maria" })],
    "faizahTraci"
  );
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((p) => p.matchStatus === "matched"));
  assert.ok(pairs.every((p) => p.priors[0]?.actorName === "Maria"));
});

test("classifies held strengthened softened and flipped", () => {
  assert.equal(classifyRecontactChange("Support Faizah", "Support Faizah", "faizahTraci"), "held");
  assert.equal(classifyRecontactChange("Undecided", "Support Faizah", "faizahTraci"), "strengthened");
  assert.equal(classifyRecontactChange("Support Faizah", "Undecided", "faizahTraci"), "softened");
  assert.equal(classifyRecontactChange("Support Faizah", "Support Traci", "faizahTraci"), "flipped");
  assert.equal(classifyRecontactChange("", "Support Faizah", "faizahTraci"), "unknown");
});

test("summarizeRecontactPairs counts match and flip buckets", () => {
  const pairs = resolvePhonebankPriors(
    [
      call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1", finalResultLabel: "Support Traci" }),
      call({ callId: "qc2", callDate: "2026-03-10", pdiId: "" }),
      call({ callId: "qc3", callDate: "2026-03-10", pdiId: "CA9" }),
    ],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1", finalResultLabel: "Support Faizah" })],
    "faizahTraci"
  );
  const stats = summarizeRecontactPairs(pairs);
  assert.equal(stats.total, 3);
  assert.equal(stats.matched, 1);
  assert.equal(stats.flipped, 1);
  assert.equal(stats.noPdi, 1);
  assert.equal(stats.unmatched, 1);
});

test("extractCallSurveyLabels prefers Final Result then polling then canvass", () => {
  const labels = extractCallSurveyLabels(
    [
      { questionName: "02 Canvass result - talking to correct person", answerValue: "Yes" },
      { questionName: "03 Polling", answerValue: "A. Undecided" },
      { questionName: "06 Final Result", answerValue: "A. Strong Support" },
    ],
    "faizahTraci"
  );
  assert.equal(labels.finalResultLabel, "Support Faizah");
  assert.equal(labels.pollingLabel, "Undecided");
  assert.equal(labels.canvassLabel, "Talking to Correct Person");
});

test("extractCallSurveyLabels keeps talking to correct person over a later non-contact column", () => {
  const labels = extractCallSurveyLabels(
    [
      { questionName: "02 Canvass result - talking to correct person", answerValue: "Yes" },
      { questionName: "02 Canvass result - not home", answerValue: "No" },
    ],
    "faizahTraci"
  );
  assert.equal(labels.canvassLabel, "Talking to Correct Person");
});

test("extractCallSurveyLabels stores not-home when that is the selected canvass result", () => {
  const labels = extractCallSurveyLabels(
    [{ questionName: "02 Canvass result - not home", answerValue: "Yes" }],
    "faizahTraci"
  );
  assert.equal(labels.canvassLabel.toLowerCase().includes("not home"), true);
  assert.equal(surveyRowIsTalkingToCorrectPerson("02 Canvass result - not home", "Yes"), false);
});

test("combined Canvass Result answers detect talking to correct person", () => {
  const labels = extractCallSurveyLabels(
    [{ questionName: "Canvass Result", answerValue: "Talking to Correct Person" }],
    "faizahTraci"
  );
  assert.equal(labels.canvassLabel, "Talking to Correct Person");
  assert.equal(surveyRowIsTalkingToCorrectPerson("Canvass Result", "Not Home"), false);
});

test("fillMissingCanvassLabel hydrates combined Canvass Result onto older snapshots", () => {
  const qc = call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1", canvassLabel: "" });
  const filled = fillMissingCanvassLabel(
    qc,
    [{ questionName: "Canvass Result", answerValue: "Talking to Correct Person" }],
    "faizahTraci"
  );
  assert.equal(filled.canvassLabel, "Talking to Correct Person");
  assert.equal(pairHasQcContact({ pairId: "qc1", qc: filled, priors: [], matchStatus: "unmatched", changeKind: "unknown" }), true);
  const declined = fillMissingCanvassLabel(
    qc,
    [{ questionName: "Canvass Result", answerValue: "Declined Conversation" }],
    "faizahTraci"
  );
  assert.equal(pairHasQcContact({ pairId: "qc1", qc: declined, priors: [], matchStatus: "unmatched", changeKind: "unknown" }), false);
});

test("extractCallSurveyLabels ignores donation and uses candidate ID when Final Result is missing", () => {
  const labels = extractCallSurveyLabels(
    [
      { questionName: "Can we count on you to support Faizah Malik?", answerValue: "Strong Support" },
      { questionName: "Would you like to donate to Faizah?", answerValue: "Undecided" },
    ],
    "faizahTraci",
    ["faizah", "malik"]
  );
  assert.equal(labels.finalResultLabel, "Support Faizah");
});

test("resolveCanvassPriors is empty unless a knock index is supplied", () => {
  assert.deepEqual(resolveCanvassPriors("CA1", faizahTag, "2026-03-10", "2026-03-10T18:00:00"), []);
});

test("canvass-only prior marks the pair matched and uses PRIMARYID = PDI", () => {
  const pairs = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1", finalResultLabel: "Support Faizah" })],
    [],
    "faizahTraci"
  );
  assert.equal(pairs[0]?.matchStatus, "unmatched");
  const index: QcCanvassKnockIndexRow[] = [
    {
      primaryId: "ca1",
      canvasserName: "Sam Door",
      assignmentName: "Faizah Turf 4",
      occurredAt: "2026-03-02T15:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "rep-1",
    },
  ];
  const merged = mergeCanvassPriorsIntoPairs(pairs, faizahTag, index, "faizahTraci");
  assert.equal(merged[0]?.matchStatus, "matched");
  assert.equal(merged[0]?.priors.length, 1);
  assert.equal(merged[0]?.priors[0]?.channel, "canvass");
  assert.equal(merged[0]?.changeKind, "held");
  assert.equal(pairMatchesChannelChip(merged[0]!, "canvass"), true);
  assert.equal(pairMatchesChannelChip(merged[0]!, "phonebank"), false);
});

test("replaces saved canvass priors from the current knock index", () => {
  const saved = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", callAt: "2026-03-10T18:00:00", pdiId: "CA1", finalResultLabel: "Support Faizah" })],
    [],
    "faizahTraci"
  );
  const stale: QcRecontactPair = {
    ...saved[0]!,
    matchStatus: "matched",
    changeKind: "held",
    priors: [
      {
        channel: "canvass",
        pdiId: "CA1",
        actorName: "Old Canvasser",
        occurredOn: "2026-02-01",
        listOrAssignment: "Faizah Old Turf",
        resultLabel: "Strong Support",
        callAt: "2026-02-01T12:00:00",
      },
    ],
  };
  const cleared = replaceCanvassPriorsFromKnockIndex([stale], faizahTag, [], "faizahTraci");
  assert.equal(cleared[0]?.priors.length, 0);
  assert.equal(cleared[0]?.matchStatus, "unmatched");
  assert.equal(pairMatchesChannelChip(cleared[0]!, "canvass"), false);

  const index: QcCanvassKnockIndexRow[] = [
    {
      primaryId: "CA1",
      canvasserName: "Sam Door",
      assignmentName: "Faizah Turf 4",
      occurredAt: "2026-03-02T15:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "rep-1",
    },
  ];
  const refreshed = replaceCanvassPriorsFromKnockIndex([stale], faizahTag, index, "faizahTraci");
  assert.equal(refreshed[0]?.priors.length, 1);
  assert.equal(refreshed[0]?.priors[0]?.actorName, "Sam Door");
  assert.equal(refreshed[0]?.matchStatus, "matched");
  assert.equal(pairMatchesChannelChip(refreshed[0]!, "canvass"), true);
});

test("keeps phone and canvass priors separate and changeKind uses the latest channel", () => {
  const pairs = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", callAt: "2026-03-10T18:00:00", pdiId: "CA1", finalResultLabel: "Support Faizah" })],
    [call({ callId: "r1", callDate: "2026-03-01", callAt: "2026-03-01T12:00:00", pdiId: "CA1", phonebankerName: "Maria", finalResultLabel: "Undecided" })],
    "faizahTraci"
  );
  const index: QcCanvassKnockIndexRow[] = [
    {
      primaryId: "CA1",
      canvasserName: "Sam Door",
      assignmentName: "Faizah Walk",
      occurredAt: "2026-03-05T16:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "rep-1",
    },
  ];
  const merged = mergeCanvassPriorsIntoPairs(pairs, faizahTag, index, "faizahTraci");
  assert.equal(merged[0]?.priors.length, 2);
  assert.equal(merged[0]?.priors[0]?.channel, "canvass");
  assert.equal(merged[0]?.priors[1]?.channel, "phonebank");
  assert.equal(merged[0]?.changeKind, "held");
  assert.equal(pairMatchesChannelChip(merged[0]!, "phonebank"), true);
  assert.equal(pairMatchesChannelChip(merged[0]!, "canvass"), true);
});

test("resolveCanvassPriors matches the candidate question, not the turf or file name", () => {
  const index: QcCanvassKnockIndexRow[] = [
    {
      primaryId: "ca1",
      canvasserName: "Sam Door",
      assignmentName: "Ana Lidia N QC 9-13-26",
      sourceFileName: "Canvasser Details.csv",
      occurredAt: "2026-03-02T15:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "rep-1",
    },
    {
      primaryId: "CA1",
      canvasserName: "Other Candidate",
      assignmentName: "Faizah Turf 4",
      occurredAt: "2026-03-03T15:00:00",
      question: "Can we count on you to support Ada?",
      response: "Undecided",
      reportId: "rep-2",
    },
  ];
  const priors = resolveCanvassPriors("CA1", faizahTag, "2026-03-10", "2026-03-10T18:00:00", index);
  assert.equal(priors.length, 1);
  assert.equal(priors[0]?.channel, "canvass");
  assert.equal(priors[0]?.actorName, "Sam Door");
  assert.equal(priors[0]?.listOrAssignment, "Ana Lidia N QC 9-13-26");
  assert.equal(knockMatchesPrimaryTag(index[0]!, faizahTag), false);
  assert.equal(knockIsQcSupportChecker(index[0]!, faizahTag), true);
  assert.equal(knockIsQcSupportChecker(index[1]!, faizahTag), false);
});

test("canvass prior ignores a later donation and uses the candidate ID support answer", () => {
  const index: QcCanvassKnockIndexRow[] = [
    {
      primaryId: "CA1",
      canvasserName: "Sam Door",
      assignmentName: "Faizah Turf 4",
      occurredAt: "2026-03-02T15:00:00",
      question: "Can we count on you to support Faizah Malik?",
      response: "Strong Support",
      reportId: "rep-1",
    },
    {
      primaryId: "CA1",
      canvasserName: "Sam Door",
      assignmentName: "Faizah Turf 4",
      occurredAt: "2026-03-02T15:05:00",
      question: "Would you like to donate to Faizah?",
      response: "Undecided",
      reportId: "rep-1",
    },
  ];
  assert.equal(knockIsQcSupportChecker(index[0]!, faizahTag), true);
  assert.equal(knockIsQcSupportChecker(index[1]!, faizahTag), false);
  const priors = resolveCanvassPriors("CA1", faizahTag, "2026-03-10", "2026-03-10T18:00:00", index);
  assert.equal(priors.length, 1);
  assert.equal(priors[0]?.resultLabel, "Strong Support");
});

test("pairMatchesSelections ORs within a group and ANDs across groups", () => {
  const phoneHeld: QcRecontactPair = {
    pairId: "qc1",
    matchStatus: "matched",
    changeKind: "held",
    qc: call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" }),
    priors: [
      {
        channel: "phonebank",
        pdiId: "CA1",
        actorName: "Maria",
        occurredOn: "2026-03-01",
        listOrAssignment: "Faizah 001",
        resultLabel: "Strong Support",
      },
    ],
  };
  const textSoftened: QcRecontactPair = {
    pairId: "qc2",
    matchStatus: "matched",
    changeKind: "softened",
    qc: call({ callId: "qc2", callDate: "2026-03-10", pdiId: "CA2" }),
    priors: [
      {
        channel: "text",
        pdiId: "CA2",
        actorName: "Sam",
        occurredOn: "2026-03-01",
        listOrAssignment: "Faizah Text",
        resultLabel: "Strong Support",
        hasInboundReply: true,
      },
    ],
  };
  const empty = emptyRecontactSelection();
  assert.equal(pairMatchesSelections(phoneHeld, empty), true);
  assert.equal(pairMatchesSelections(phoneHeld, { ...empty, channels: ["phonebank"] }), true);
  assert.equal(pairMatchesSelections(phoneHeld, { ...empty, channels: ["text"] }), false);
  assert.equal(pairMatchesSelections(phoneHeld, { ...empty, channels: ["phonebank", "text"] }), true);
  assert.equal(pairMatchesSelections(textSoftened, { ...empty, channels: ["phonebank", "text"] }), true);
  assert.equal(pairMatchesSelections(phoneHeld, { ...empty, outcomes: ["held", "softened"] }), true);
  assert.equal(pairMatchesSelections(textSoftened, { ...empty, outcomes: ["held", "softened"] }), true);
  assert.equal(
    pairMatchesSelections(textSoftened, { ...empty, channels: ["text"], outcomes: ["softened"] }),
    true
  );
  assert.equal(
    pairMatchesSelections(phoneHeld, { ...empty, channels: ["text"], outcomes: ["softened"] }),
    false
  );
});

test("No Reply matches only a text prior with hasInboundReply false", () => {
  const empty = emptyRecontactSelection();
  const noReply: QcRecontactPair = {
    pairId: "qc1",
    matchStatus: "matched",
    changeKind: "unknown",
    qc: call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1" }),
    priors: [
      {
        channel: "text",
        pdiId: "CA1",
        actorName: "Sam",
        occurredOn: "2026-03-01",
        listOrAssignment: "Faizah Text",
        resultLabel: "",
        hasInboundReply: false,
      },
    ],
  };
  const replied: QcRecontactPair = {
    ...noReply,
    pairId: "qc2",
    priors: [{ ...noReply.priors[0]!, hasInboundReply: true, resultLabel: "Strong Support" }],
  };
  const legacy: QcRecontactPair = {
    ...noReply,
    pairId: "qc3",
    priors: [{ ...noReply.priors[0]!, hasInboundReply: undefined }],
  };
  const phoneOnly: QcRecontactPair = {
    pairId: "qc4",
    matchStatus: "matched",
    changeKind: "held",
    qc: call({ callId: "qc4", callDate: "2026-03-10", pdiId: "CA4" }),
    priors: [
      {
        channel: "phonebank",
        pdiId: "CA4",
        actorName: "Maria",
        occurredOn: "2026-03-01",
        listOrAssignment: "Faizah 001",
        resultLabel: "Strong Support",
      },
    ],
  };
  const noReplyOnly = { ...empty, outcomes: ["no_reply" as const] };
  assert.equal(pairMatchesSelections(noReply, noReplyOnly), true);
  assert.equal(pairMatchesSelections(replied, noReplyOnly), false);
  assert.equal(pairMatchesSelections(legacy, noReplyOnly), false);
  assert.equal(pairMatchesSelections(phoneOnly, noReplyOnly), false);
});

test("donation-only knocks do not create a canvass prior", () => {
  const priors = resolveCanvassPriors("CA1", faizahTag, "2026-03-10", "2026-03-10T18:00:00", [
    {
      primaryId: "CA1",
      canvasserName: "Sam Door",
      assignmentName: "Faizah Turf 4",
      occurredAt: "2026-03-02T15:05:00",
      question: "Would you like to donate to Faizah?",
      response: "Yes, I will donate",
      reportId: "rep-1",
    },
  ]);
  assert.equal(priors.length, 0);
});

test("extractCallSurveyLabels stores Were you contacted in English and Spanish", () => {
  const english = extractCallSurveyLabels(
    [{ questionName: "04 Were you contacted?", answerValue: "Yes" }],
    "faizahTraci"
  );
  assert.equal(english.contactedQuestion, "04 Were you contacted?");
  assert.equal(english.contactedAnswer, "Yes");
  assert.equal(isWereYouContactedQuestion("¿Te contactaron?"), true);
  const spanish = extractCallSurveyLabels(
    [{ questionName: "¿Fue contactado por un canvasser?", answerValue: "No" }],
    "faizahTraci"
  );
  assert.equal(spanish.contactedAnswer, "No");
  assert.equal(
    extractCallSurveyLabels([{ questionName: "04 Were you contacted?", answerValue: "[no answer recorded]" }], "faizahTraci")
      .contactedAnswer,
    ""
  );
});

test("fillMissingCanvassLabel also hydrates polling and Were you contacted", () => {
  const qc = call({
    callId: "qc1",
    callDate: "2026-03-10",
    canvassLabel: "Talking to Correct Person",
    pollingLabel: "",
    contactedAnswer: "",
  });
  const filled = fillMissingCanvassLabel(
    qc,
    [
      { questionName: "03 Polling", answerValue: "A. Undecided" },
      { questionName: "Were you contacted?", answerValue: "Yes" },
    ],
    "faizahTraci"
  );
  assert.equal(filled.canvassLabel, "Talking to Correct Person");
  assert.equal(filled.pollingLabel, "Undecided");
  assert.equal(filled.contactedAnswer, "Yes");
});

test("pairIsUsefulRecontact drops a correct-person call with no recorded answer", () => {
  const blank = call({
    callId: "qc1",
    callDate: "2026-03-10",
    pdiId: "CA1",
    finalResultLabel: "",
    pollingLabel: "",
    canvassLabel: "Talking to Correct Person",
    contactedAnswer: "",
  });
  const matched = resolvePhonebankPriors([blank], [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1" })], "faizahTraci")[0]!;
  assert.equal(matched.matchStatus, "matched");
  assert.equal(pairHasQcContact(matched), true);
  assert.equal(pairIsUsefulRecontact(matched), false);

  const pollingOnly = {
    ...matched,
    qc: { ...matched.qc, pollingLabel: "Undecided" },
  };
  assert.equal(pairIsUsefulRecontact(pollingOnly), true);

  const contactedOnly = {
    ...matched,
    qc: { ...matched.qc, pollingLabel: "", contactedAnswer: "No" },
  };
  assert.equal(pairIsUsefulRecontact(contactedOnly), false);
  assert.equal(
    pairIsUsefulRecontact({
      ...matched,
      qc: { ...matched.qc, contactedAnswer: "[no answer recorded]" },
    }),
    false
  );
});

test("prior filter matches phonebankers and canvassers; QC filter matches the QC caller", () => {
  const pair: QcRecontactPair = {
    pairId: "qc1",
    matchStatus: "matched",
    changeKind: "held",
    qc: call({
      callId: "qc1",
      callDate: "2026-03-10",
      pdiId: "CA1",
      phonebankerName: "Jonathan Fields",
      canvassLabel: "Talking to Correct Person",
    }),
    priors: [
      {
        channel: "phonebank",
        pdiId: "CA1",
        actorName: "Maria",
        occurredOn: "2026-03-01",
        listOrAssignment: "Faizah 001",
        resultLabel: "Strong Support",
      },
      {
        channel: "canvass",
        pdiId: "CA1",
        actorName: "Sam Door",
        occurredOn: "2026-03-02",
        listOrAssignment: "Faizah Turf 4",
        resultLabel: "Strong Support",
      },
      {
        channel: "text",
        pdiId: "CA1",
        actorName: "Texter Only",
        occurredOn: "2026-03-03",
        listOrAssignment: "Text blast",
        resultLabel: "Strong Support",
      },
    ],
  };
  const empty = emptyRecontactSelection();
  assert.deepEqual(priorActorNamesForPairs([pair]), ["Maria", "Sam Door"]);
  assert.deepEqual(qcCallerNamesForPairs([pair]), ["Jonathan Fields"]);
  assert.equal(pairMatchesPriorActor(pair, "Maria"), true);
  assert.equal(pairMatchesPriorActor(pair, "Sam Door"), true);
  assert.equal(pairMatchesPriorActor(pair, "Texter Only"), false);
  assert.equal(pairMatchesQcCaller(pair, "Jonathan Fields"), true);
  assert.equal(pairMatchesQcCaller(pair, "Maria"), false);
  assert.equal(pairMatchesSelections(pair, { ...empty, priorActor: "Sam Door" }), true);
  assert.equal(pairMatchesSelections(pair, { ...empty, priorActor: "Maria" }), true);
  assert.equal(pairMatchesSelections(pair, { ...empty, qcCaller: "Jonathan Fields" }), true);
  assert.equal(pairMatchesSelections(pair, { ...empty, priorActor: "Maria", qcCaller: "Jonathan Fields" }), true);
  assert.equal(pairMatchesSelections(pair, { ...empty, priorActor: "Sam Door", qcCaller: "Maria" }), false);
  assert.equal(pairMatchesSelections(pair, { ...empty, priorActor: "Texter Only", channels: ["text"] }), false);
});

test("pairWithSupportAnswers drops priors that have no support label and uses the canvass result", () => {
  const pair: QcRecontactPair = {
    pairId: "qc1",
    matchStatus: "matched",
    changeKind: "unknown",
    qc: call({
      callId: "qc1",
      callDate: "2026-03-10",
      pdiId: "CA1",
      finalResultLabel: "Support Faizah",
      canvassLabel: "Talking to Correct Person",
    }),
    priors: [
      {
        channel: "phonebank",
        pdiId: "CA1",
        actorName: "Vikas B",
        occurredOn: "2026-03-09",
        listOrAssignment: "QC list",
        resultLabel: "",
        callAt: "2026-03-09T18:00:00",
      },
      {
        channel: "canvass",
        pdiId: "CA1",
        actorName: "Sam Door",
        occurredOn: "2026-03-02",
        listOrAssignment: "Turf",
        resultLabel: "Strong Support",
        callAt: "2026-03-02T15:00:00",
      },
    ],
  };
  const shown = pairWithSupportAnswers(pair);
  assert.equal(shown.priors.length, 1);
  assert.equal(shown.priors[0]?.channel, "canvass");
  assert.equal(shown.changeKind, "held");
  assert.equal(shown.matchStatus, "matched");
});

test("empty QC voter name falls back to the matched knock sheet voter", () => {
  const pairs = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1", voterName: "", voterAddress: "1 Main St" })],
    [],
    "faizahTraci"
  );
  const index: QcCanvassKnockIndexRow[] = [
    {
      primaryId: "CA1",
      canvasserName: "Sam Door",
      assignmentName: "Faizah Turf 4",
      occurredAt: "2026-03-02T15:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "rep-1",
      voterName: "Ada Lovelace",
    },
  ];
  const merged = mergeCanvassPriorsIntoPairs(pairs, faizahTag, index, "faizahTraci");
  assert.equal(merged[0]?.qc.voterName, "Ada Lovelace");
  assert.equal(merged[0]?.qc.voterAddress, "1 Main St");

  const named = resolvePhonebankPriors(
    [call({ callId: "qc2", callDate: "2026-03-10", pdiId: "CA1", voterName: "Phone Name" })],
    [],
    "faizahTraci"
  );
  const kept = mergeCanvassPriorsIntoPairs(named, faizahTag, index, "faizahTraci");
  assert.equal(kept[0]?.qc.voterName, "Phone Name");
});

function knockDay(row: QcCanvassKnockIndexRow): string {
  const stamp = row.occurredAt.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(stamp)) return stamp.slice(0, 10);
  return "";
}

/** The pre-index full scan. The PDI map must return this same prior. */
function linearLatestSupportKnock(
  pdiId: string,
  primaryTag: CampaignTag,
  beforeDate: string,
  beforeAt: string | undefined,
  knockIndex: readonly QcCanvassKnockIndexRow[]
): QcCanvassKnockIndexRow | null {
  const want = normalizeRecontactPersonId(pdiId);
  if (!want || knockIndex.length === 0) return null;
  const profile = resolveSurveyScriptProfile(primaryTag);
  const matches = knockIndex.filter((row) => {
    if (normalizeRecontactPersonId(row.primaryId) !== want) return false;
    if (!knockIsQcSupportChecker(row, primaryTag, profile)) return false;
    const occurredOn = knockDay(row);
    if (!occurredOn) return false;
    return callOccurredBefore(occurredOn, row.occurredAt, beforeDate, beforeAt);
  });
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const byStamp = (b.occurredAt || "").localeCompare(a.occurredAt || "");
    if (byStamp !== 0) return byStamp;
    return (b.reportId || "").localeCompare(a.reportId || "");
  });
  return matches[0] ?? null;
}

test("PDI index picks the same prior as a full knock scan", () => {
  const index: QcCanvassKnockIndexRow[] = [
    {
      primaryId: "ca 1",
      canvasserName: "Older",
      assignmentName: "Faizah Turf 1",
      occurredAt: "2026-03-01T10:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Undecided",
      reportId: "a",
    },
    {
      primaryId: "CA1",
      canvasserName: "Newer",
      assignmentName: "Faizah Turf 2",
      occurredAt: "2026-03-04T10:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "b",
    },
    {
      primaryId: "CA1",
      canvasserName: "Tie Low",
      assignmentName: "Faizah Turf 2",
      occurredAt: "2026-03-04T10:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "a",
    },
    {
      primaryId: "CA2",
      canvasserName: "Other Person",
      assignmentName: "Faizah Turf 9",
      occurredAt: "2026-03-08T10:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "z",
    },
    {
      primaryId: "CA1",
      canvasserName: "After QC",
      assignmentName: "Faizah Turf 3",
      occurredAt: "2026-03-11T10:00:00",
      question: "Can we count on you to support Faizah?",
      response: "Undecided",
      reportId: "c",
    },
    {
      primaryId: "CA1",
      canvasserName: "No Date",
      assignmentName: "Faizah Turf 4",
      occurredAt: "",
      question: "Can we count on you to support Faizah?",
      response: "Strong Support",
      reportId: "d",
    },
    {
      primaryId: "CA1",
      canvasserName: "Donation",
      assignmentName: "Faizah Turf 5",
      occurredAt: "2026-03-05T10:00:00",
      question: "Would you like to donate to Faizah?",
      response: "Undecided",
      reportId: "e",
    },
  ];
  const beforeDate = "2026-03-10";
  const beforeAt = "2026-03-10T18:00:00";
  const scanned = linearLatestSupportKnock("CA1", faizahTag, beforeDate, beforeAt, index);
  const priors = resolveCanvassPriors("CA1", faizahTag, beforeDate, beforeAt, index);
  assert.equal(scanned?.canvasserName, "Newer");
  assert.equal(priors.length, 1);
  assert.equal(priors[0]?.actorName, scanned?.canvasserName);
  assert.equal(priors[0]?.callAt, scanned?.occurredAt);
  assert.equal(priors[0]?.resultLabel, scanned?.response.trim());

  const otherScan = linearLatestSupportKnock("CA2", faizahTag, beforeDate, beforeAt, index);
  const otherPriors = resolveCanvassPriors("CA2", faizahTag, beforeDate, beforeAt, index);
  assert.equal(otherScan?.canvasserName, "Other Person");
  assert.equal(otherPriors[0]?.actorName, otherScan?.canvasserName);
  assert.equal(otherPriors[0]?.callAt, otherScan?.occurredAt);
});

test("matchesPdiOrNameQuery keeps full PDI matches and adds name matches", () => {
  assert.equal(matchesPdiOrNameQuery("", "CA55278516", "Joseph Mosqueda"), true);
  assert.equal(matchesPdiOrNameQuery("CA55278516", "CA55278516", "Joseph Mosqueda"), true);
  assert.equal(matchesPdiOrNameQuery("ca55278516", "CA55278516", ""), true);
  assert.equal(matchesPdiOrNameQuery("CA 55278516", "CA55278516", ""), true);
  assert.equal(matchesPdiOrNameQuery("55278516", "CA55278516", "Joseph Mosqueda"), true);
  assert.equal(matchesPdiOrNameQuery("Mosqueda", "CA55278516", "Joseph Mosqueda"), true);
  assert.equal(matchesPdiOrNameQuery("joseph mosqueda", "CA55278516", "Joseph Mosqueda"), true);
  assert.equal(matchesPdiOrNameQuery("Nobody", "CA55278516", "Joseph Mosqueda"), false);
});
