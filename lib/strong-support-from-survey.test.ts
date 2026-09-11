import test from "node:test";
import assert from "node:assert/strict";
import type { CallSurveyRowForFill } from "./types";
import {
  applyCallLevelStrongSupportToDailyCaller,
  campaignHasFinalResultTab,
  candidateTermsForTag,
  countStrongSupportBySession,
  formatStrongSupportCell,
  isCandidateIdSupportQuestion,
  overlayStrongSupportCountsFromQuestionStats,
  questionTiesToCandidate,
  strongSupportForCall,
} from "./strong-support-from-survey";

const NITHYA_TERMS = candidateTermsForTag({
  id: "nithya",
  label: "Nithya Raman",
  searchTerms: ["nithya"],
});
const FAIZAH_TERMS = candidateTermsForTag({
  id: "faizah",
  label: "Faizah Malik",
  searchTerms: ["faizah", "malik"],
});

const NITHYA_Q = "1. Can we count on your vote for Nithya Raman for Mayor?";

function fillRow(
  partial: Partial<CallSurveyRowForFill> &
    Pick<CallSurveyRowForFill, "questionName" | "answerValue">
): CallSurveyRowForFill {
  return {
    callId: "c1",
    campaignId: "camp-nithya",
    campaignName: "Nithya PB 9.2",
    callDate: "2026-09-07",
    phonebankerName: "Ava",
    surveyResultId: 1,
    ...partial,
  };
}

test("candidateTermsForTag includes aliases like raman for nithya", () => {
  assert.ok(NITHYA_TERMS.includes("nithya"));
  assert.ok(NITHYA_TERMS.includes("raman"));
});

test("questionTiesToCandidate requires the candidate token", () => {
  assert.equal(questionTiesToCandidate(NITHYA_Q, NITHYA_TERMS), true);
  assert.equal(questionTiesToCandidate("Support?", NITHYA_TERMS), false);
  assert.equal(questionTiesToCandidate("Can we count on your vote?", NITHYA_TERMS), false);
});

test("Nithya ID question + Strong Support is SS when campaign has no FR tab", () => {
  assert.equal(
    isCandidateIdSupportQuestion(NITHYA_Q, NITHYA_TERMS, "faizahTraci", [
      "A. Strong Support for Nithya",
    ]),
    true
  );
  assert.deepEqual(
    strongSupportForCall(
      [fillRow({ questionName: NITHYA_Q, answerValue: "A. Strong Support for Nithya" })],
      "faizahTraci",
      NITHYA_TERMS,
      false
    ),
    { hit: 1, synthesized: false }
  );
});

test("same ID answer is ignored for SS when the campaign also has Final Result", () => {
  const rows = [
    fillRow({ questionName: NITHYA_Q, answerValue: "A. Strong Support for Nithya", surveyResultId: 1 }),
    fillRow({
      questionName: "Final Result",
      answerValue: "B. Undecided",
      surveyResultId: 2,
    }),
  ];
  assert.equal(campaignHasFinalResultTab(rows), true);
  assert.deepEqual(strongSupportForCall(rows, "faizahTraci", NITHYA_TERMS, true), {
    hit: 0,
    synthesized: false,
  });
});

test("Faizah FR SS still counts; polling SS is added only via synthesis when the call has no FR", () => {
  const frSs = [
    fillRow({
      campaignId: "camp-f",
      questionName: "Final Result",
      answerValue: "A. Strong Support",
    }),
  ];
  assert.deepEqual(strongSupportForCall(frSs, "faizahTraci", FAIZAH_TERMS, true), {
    hit: 1,
    synthesized: false,
  });

  const pollingOnly = [
    fillRow({
      campaignId: "camp-f",
      questionName: "01 Polling",
      answerValue: "A. Strong Support",
    }),
  ];
  assert.deepEqual(strongSupportForCall(pollingOnly, "faizahTraci", FAIZAH_TERMS, true), {
    hit: 1,
    synthesized: true,
  });
  assert.deepEqual(strongSupportForCall(pollingOnly, "faizahTraci", FAIZAH_TERMS, false), {
    hit: 0,
    synthesized: false,
  });

  const frUndecidedPlusPollingSs = [
    fillRow({
      campaignId: "camp-f",
      questionName: "01 Polling",
      answerValue: "A. Strong Support",
      surveyResultId: 1,
    }),
    fillRow({
      campaignId: "camp-f",
      questionName: "Final Result",
      answerValue: "B. Undecided",
      surveyResultId: 2,
    }),
  ];
  assert.deepEqual(
    strongSupportForCall(frUndecidedPlusPollingSs, "faizahTraci", FAIZAH_TERMS, true),
    { hit: 0, synthesized: false }
  );
});

test("Canvass Result and disclaimer never count as SS", () => {
  assert.deepEqual(
    strongSupportForCall(
      [fillRow({ questionName: "Canvass Result", answerValue: "Talking to Correct Person" })],
      "faizahTraci",
      NITHYA_TERMS,
      false
    ),
    { hit: 0, synthesized: false }
  );
  assert.deepEqual(
    strongSupportForCall(
      [fillRow({ questionName: "2. Disclaimer", answerValue: "A. Read Disclaimer" })],
      "faizahTraci",
      NITHYA_TERMS,
      false
    ),
    { hit: 0, synthesized: false }
  );
});

test("session rollup: two answers on one call_id count as 1", () => {
  const rows = [
    fillRow({
      callId: "same",
      questionName: NITHYA_Q,
      answerValue: "A. Strong Support for Nithya",
      surveyResultId: 1,
    }),
    fillRow({
      callId: "same",
      questionName: NITHYA_Q,
      answerValue: "A. Strong Support for Nithya",
      surveyResultId: 2,
    }),
  ];
  const map = countStrongSupportBySession(rows, "faizahTraci", NITHYA_TERMS);
  assert.equal(map.total.get("camp-nithya::2026-09-07::Ava"), 1);
  assert.equal(map.synthesized.get("camp-nithya::2026-09-07::Ava"), undefined);
});

test("overlay from question-stats uses ID answers when there is no FR tab", () => {
  const counts = overlayStrongSupportCountsFromQuestionStats(
    [
      {
        campaignId: "d740",
        campaignName: "Nithya PB 9.2",
        callDate: "2026-09-07",
        phonebankerName: "Ava",
        questionName: NITHYA_Q,
        answerValue: "A. Strong Support for Nithya",
        responseCount: 48,
      },
      {
        campaignId: "d740",
        campaignName: "Nithya PB 9.2",
        callDate: "2026-09-07",
        phonebankerName: "Ava",
        questionName: "Canvass Result",
        answerValue: "Talking to Correct Person",
        responseCount: 72,
      },
    ],
    "d740",
    "faizahTraci",
    NITHYA_TERMS
  );
  assert.equal(counts.get("2026-09-07::Ava"), 48);
});

test("overlay ignores ID SS when the campaign has a Final Result tab", () => {
  const counts = overlayStrongSupportCountsFromQuestionStats(
    [
      {
        campaignId: "f1",
        campaignName: "Faizah PB",
        callDate: "2026-09-01",
        phonebankerName: "Jane",
        questionName: "01 Polling",
        answerValue: "A. Strong Support",
        responseCount: 10,
      },
      {
        campaignId: "f1",
        campaignName: "Faizah PB",
        callDate: "2026-09-01",
        phonebankerName: "Jane",
        questionName: "Final Result",
        answerValue: "A. Strong Support",
        responseCount: 4,
      },
    ],
    "f1",
    "faizahTraci",
    FAIZAH_TERMS
  );
  assert.equal(counts.get("2026-09-01::Jane"), 4);
});

test("applyCallLevelStrongSupportToDailyCaller writes session SS", () => {
  const daily = [
    {
      campaignId: "camp-nithya",
      campaignName: "Nithya PB 9.2",
      callDate: "2026-09-07",
      phonebankerName: "Ava",
      totalCalls: 1,
      callsAnswered: 1,
      talkingToCorrectPerson: 1,
      surveyed: 1,
      strongSupport: 0,
      numDials: 1,
      totalCallSeconds: 60,
      totalDialerSeconds: 120,
    },
  ];
  const patched = applyCallLevelStrongSupportToDailyCaller(
    daily,
    [fillRow({ questionName: NITHYA_Q, answerValue: "A. Strong Support for Nithya" })],
    "faizahTraci",
    NITHYA_TERMS
  );
  assert.equal(patched[0]?.strongSupport, 1);
  assert.equal(patched[0]?.strongSupportSynthesized, 0);
});

test("formatStrongSupportCell notes synthesized subset", () => {
  assert.equal(formatStrongSupportCell(12, 0), "12");
  assert.equal(formatStrongSupportCell(12, 3), "12 (3 Synthesized)");
});

test("applyCallLevelStrongSupportToDailyCaller splits synthesized FR fills", () => {
  const daily = [
    {
      campaignId: "camp-f",
      campaignName: "Faizah PB",
      callDate: "2026-09-01",
      phonebankerName: "Jane",
      totalCalls: 2,
      callsAnswered: 2,
      talkingToCorrectPerson: 2,
      surveyed: 2,
      strongSupport: 0,
      numDials: 2,
      totalCallSeconds: 60,
      totalDialerSeconds: 120,
    },
  ];
  const patched = applyCallLevelStrongSupportToDailyCaller(
    daily,
    [
      fillRow({
        callId: "a",
        campaignId: "camp-f",
        campaignName: "Faizah PB",
        callDate: "2026-09-01",
        phonebankerName: "Jane",
        questionName: "Final Result",
        answerValue: "A. Strong Support",
      }),
      fillRow({
        callId: "b",
        campaignId: "camp-f",
        campaignName: "Faizah PB",
        callDate: "2026-09-01",
        phonebankerName: "Jane",
        questionName: "01 Polling",
        answerValue: "A. Strong Support",
      }),
    ],
    "faizahTraci",
    FAIZAH_TERMS
  );
  assert.equal(patched[0]?.strongSupport, 2);
  assert.equal(patched[0]?.strongSupportSynthesized, 1);
});
