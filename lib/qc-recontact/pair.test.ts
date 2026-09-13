import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignTag } from "../types";
import { classifyRecontactChange } from "./change";
import { normalizeRecontactPersonId } from "./ids";
import { extractCallSurveyLabels } from "./labels";
import { knockIsQcSupportChecker, knockMatchesPrimaryTag, mergeCanvassPriorsIntoPairs, resolveCanvassPriors } from "./canvass";
import { pairHasQcContact, pairMatchesFilter, resolvePhonebankPriors, summarizeRecontactPairs } from "./pair";
import type { QcCanvassKnockIndexRow, RecontactCallSummary } from "./types";

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
    finalResultLabel: "Support Faizah",
    pollingLabel: "",
    canvassLabel: "",
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

test("pairHasQcContact is false when the QC call has no Final Result", () => {
  const withResult = resolvePhonebankPriors(
    [call({ callId: "qc1", callDate: "2026-03-10", pdiId: "CA1", finalResultLabel: "Support Faizah" })],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1" })],
    "faizahTraci"
  )[0]!;
  const noResult = resolvePhonebankPriors(
    [call({ callId: "qc2", callDate: "2026-03-10", pdiId: "CA1", finalResultLabel: "" })],
    [call({ callId: "r1", callDate: "2026-03-01", pdiId: "CA1" })],
    "faizahTraci"
  )[0]!;
  assert.equal(pairHasQcContact(withResult), true);
  assert.equal(pairHasQcContact(noResult), false);
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
  assert.equal(labels.canvassLabel, "Yes");
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
  assert.equal(pairMatchesFilter(merged[0]!, "canvass"), true);
  assert.equal(pairMatchesFilter(merged[0]!, "phonebank"), false);
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
  assert.equal(pairMatchesFilter(merged[0]!, "phonebank"), true);
  assert.equal(pairMatchesFilter(merged[0]!, "canvass"), true);
});

test("resolveCanvassPriors matches PRIMARYID and candidate assignment when an index is passed", () => {
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
    {
      primaryId: "CA1",
      canvasserName: "Other Candidate",
      assignmentName: "Ada Walk",
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
  assert.equal(knockMatchesPrimaryTag(index[0]!, faizahTag), true);
  assert.equal(knockMatchesPrimaryTag(index[1]!, faizahTag), false);
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
