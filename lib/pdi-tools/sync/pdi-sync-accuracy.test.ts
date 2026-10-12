import test from "node:test";
import assert from "node:assert/strict";
import type { MappingOutput } from "@/lib/pdi-tools/types";
import { normalizeIsoDateRange } from "@/lib/validation/iso-date";
import { addStoredFlagToLedger, ledgerDaysForStoredFlag, ledgerHasPostedFlag, ledgerKey } from "./ledger";
import { buildMappingMaps } from "./mapping";
import { buildMappingReport } from "./sync-reports";
import { fillFinalResults } from "./fill-final";
import type { SyncLogger } from "./logger";
import type { SurveyResultRow } from "./types";

function mappingOutput(answerMappings: MappingOutput["answerMappings"]): MappingOutput {
  return {
    schemaVersion: 2,
    generated: "2026-06-01T00:00:00.000Z",
    description: "test mapping",
    stats: {
      totalQuestionMappings: 2,
      totalAnswerMappings: answerMappings.length,
      surveys: 1,
    },
    flagRegistry: [
      {
        flagId: "flag_support",
        code: "SUPPORT",
        desc: "Support",
        scope: "question-specific",
        usedInNQuestions: 1,
      },
      {
        flagId: "flag_unmapped",
        code: "LOOKS_LIKE_A_FLAG",
        desc: "Should not be used without an answer mapping",
        scope: "question-specific",
        usedInNQuestions: 1,
      },
    ],
    questionMappings: [
      {
        key: "Campaign A||Question 1",
        surveyName: "Campaign A",
        stwQuestionName: "Question 1",
        pdiQuestionId: "pdi_q_1",
        mode: "question",
        confidence: "manual",
        method: "user-selected",
      },
      {
        key: "Campaign A||Final Result",
        surveyName: "Campaign A",
        stwQuestionName: "Final Result",
        pdiQuestionId: "pdi_final",
        mode: "question",
        confidence: "manual",
        method: "user-selected",
      },
      {
        key: "Campaign A||Canvass Result",
        surveyName: "Campaign A",
        stwQuestionName: "Canvass Result",
        pdiQuestionId: "pdi_canvass",
        mode: "question",
        confidence: "manual",
        method: "user-selected",
      },
    ],
    answerMappings,
  };
}

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  step: () => undefined,
} as unknown as SyncLogger;

test("normalizeIsoDateRange rejects impossible and reversed ranges", () => {
  assert.equal(normalizeIsoDateRange("2026-02-30", "2026-03-01").ok, false);
  assert.equal(normalizeIsoDateRange("2026-06-02", "2026-06-01").ok, false);
  assert.deepEqual(normalizeIsoDateRange("2026-06-01", "2026-06-01"), {
    ok: true,
    startDate: "2026-06-01",
    endDate: "2026-06-01",
  });
});

test("buildMappingReport does not map raw flag-code-looking answers without explicit answer mapping", () => {
  const maps = buildMappingMaps(mappingOutput([]), "test.json");
  const rows: SurveyResultRow[] = [
    {
      campaign_name: "Campaign A",
      question_name: "Question 1",
      answer_value: "LOOKS_LIKE_A_FLAG",
      pdi_id: "123",
      call_id: "call-1",
      callee_id: "callee-1",
      call_time: "2026-06-01 12:00:00",
    },
  ];

  const result = buildMappingReport(rows, maps, new Set());

  assert.equal(result.payload.length, 0);
  assert.equal(result.rowsSkipped, 1);
  assert.equal(result.report[0]?.mapping_status, "UNMAPPED_ANSWER: Answer is not explicitly mapped");
});

test("buildMappingReport does not treat a Scale to Win callee id as a voter PDI id", () => {
  const maps = buildMappingMaps(
    mappingOutput([
      {
        key: "Campaign A||Final Result||Support",
        surveyName: "Campaign A",
        stwQuestionName: "Final Result",
        stwAnswerValue: "Support",
        pdiQuestionId: "pdi_final",
        pdiAnswerOptionId: "pdi_answer_support",
        pdiFlagId: "flag_support",
        pdiFlagCode: "SUPPORT",
        pdiFlagDesc: "Support",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "test.json"
  );
  const rows: SurveyResultRow[] = [
    {
      campaign_name: "Campaign A",
      question_name: "Final Result",
      answer_value: "Support",
      pdi_id: "",
      callee_id: "stw-callee-uuid",
      caller_id: "stw-caller-uuid",
      call_id: "call-1",
    },
  ];

  const result = buildMappingReport(rows, maps, new Set());

  assert.equal(result.payload.length, 0);
  assert.equal(result.rowsSkipped, 1);
  assert.equal(result.report[0]?.mapping_status, "UNMAPPED: No PDI ID");
  assert.equal(result.report[0]?.pdi_id, "");
});

test("fillFinalResults only synthesizes final results with explicit final-result answer mappings", () => {
  const maps = buildMappingMaps(
    mappingOutput([
      {
        key: "Campaign A||Final Result||Support",
        surveyName: "Campaign A",
        stwQuestionName: "Final Result",
        stwAnswerValue: "Support",
        pdiQuestionId: "pdi_final",
        pdiAnswerOptionId: "pdi_answer_support",
        pdiFlagId: "flag_support",
        pdiFlagCode: "SUPPORT",
        pdiFlagDesc: "Support",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "test.json"
  );
  const rows: SurveyResultRow[] = [
    {
      campaign_name: "Campaign A",
      question_name: "Question 1",
      answer_value: "Support",
      call_id: "call-1",
      pdi_id: "123",
    },
    {
      campaign_name: "Campaign A",
      question_name: "Question 1",
      answer_value: "LOOKS_LIKE_A_FLAG",
      call_id: "call-2",
      pdi_id: "456",
    },
  ];

  const result = fillFinalResults(rows, maps, noopLogger);

  assert.equal(result.synthetic.length, 1);
  assert.equal(result.synthetic[0]?.call_id, "call-1");
  assert.equal(result.synthetic[0]?._final_result_has_explicit_mapping, true);
  assert.equal(result.synthetic[0]?._final_result_flag_id, "flag_support");
});

function postedFlagMaps() {
  return buildMappingMaps(
    mappingOutput([
      {
        key: "Campaign A||Question 1||Support",
        surveyName: "Campaign A",
        stwQuestionName: "Question 1",
        stwAnswerValue: "Support",
        pdiQuestionId: "pdi_q_1",
        pdiAnswerOptionId: "pdi_answer_support",
        pdiFlagId: "flag_support",
        pdiFlagCode: "SUPPORT",
        pdiFlagDesc: "Support",
        confidence: "manual",
        method: "user-selected",
      },
      {
        key: "Campaign A||Canvass Result||Yes",
        surveyName: "Campaign A",
        stwQuestionName: "Canvass Result",
        stwAnswerValue: "Yes",
        pdiQuestionId: "pdi_canvass",
        pdiAnswerOptionId: "pdi_answer_canvass",
        pdiFlagId: "flag_canvass",
        pdiFlagCode: "CANVASS",
        pdiFlagDesc: "Canvass",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "test.json"
  );
}

function surveyRow(partial: Partial<SurveyResultRow> & Pick<SurveyResultRow, "question_name" | "answer_value" | "call_time">): SurveyResultRow {
  return {
    campaign_name: "Campaign A",
    pdi_id: "CA123",
    call_id: "call-1",
    callee_id: "callee-1",
    ...partial,
  };
}

test("ledger keeps midnight UTC on the posted day and a clock time on the Pacific day", () => {
  assert.deepEqual(ledgerDaysForStoredFlag("2026-09-13", "2026-09-12", "00:00:00"), ["2026-09-13"]);
  assert.deepEqual(ledgerDaysForStoredFlag("2026-09-26", "2026-09-26", "00:00:00"), ["2026-09-26"]);
  assert.deepEqual(ledgerDaysForStoredFlag("2026-09-27", "2026-09-26", "02:00:00"), ["2026-09-26"]);
  assert.equal(ledgerKey("ca123", "support", "2026-09-26T00:00:00"), "CA123|SUPPORT|2026-09-26");

  const ledger = new Set([ledgerKey("ca123", "SUPPORT", "2026-09-26"), ledgerKey("CA123", "flag_support", "2026-09-26")]);
  assert.equal(ledgerHasPostedFlag(ledger, "CA123", "SUPPORT", "2026-09-26", "flag_support"), true);
  assert.equal(ledgerHasPostedFlag(ledger, "CA123", "SUPPORT", "2026-09-27", "flag_support"), false);
  assert.equal(ledgerHasPostedFlag(ledger, "CA123", "CANVASS", "2026-09-26", "flag_canvass"), false);
});

test("a stored PDI flag code matches that flag on the same day only", () => {
  const maps = buildMappingMaps(
    mappingOutput([
      {
        key: "Campaign A||Question 1||Support",
        surveyName: "Campaign A",
        stwQuestionName: "Question 1",
        stwAnswerValue: "Support",
        pdiQuestionId: "pdi_q_1",
        pdiAnswerOptionId: "pdi_answer_support",
        pdiFlagId: "flag_support",
        pdiFlagCode: "STRONG",
        pdiFlagDesc: "Support",
        confidence: "manual",
        method: "user-selected",
      },
      {
        key: "Campaign A||Canvass Result||Yes",
        surveyName: "Campaign A",
        stwQuestionName: "Canvass Result",
        stwAnswerValue: "Yes",
        pdiQuestionId: "pdi_canvass",
        pdiAnswerOptionId: "pdi_answer_canvass",
        pdiFlagId: "flag_canvass",
        pdiFlagCode: "CANVASS",
        pdiFlagDesc: "Canvass",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "test.json"
  );
  const day = ledgerDaysForStoredFlag("2026-09-13", "2026-09-12", "00:00:00")[0] ?? "";
  const ledger = new Set<string>();
  addStoredFlagToLedger(ledger, "CA25210293", "SUPPORT", day, maps);

  const rows: SurveyResultRow[] = [
    surveyRow({
      pdi_id: "CA25210293",
      question_name: "Question 1",
      answer_value: "Support",
      call_time: "2026-09-13 18:00:00",
      call_id: "same-day",
    }),
    surveyRow({
      pdi_id: "CA25210293",
      question_name: "Question 1",
      answer_value: "Support",
      call_time: "2026-09-14 18:00:00",
      call_id: "next-day",
    }),
    surveyRow({
      pdi_id: "CA25210293",
      question_name: "Canvass Result",
      answer_value: "Yes",
      call_time: "2026-09-13 18:00:00",
      call_id: "other-flag",
    }),
  ];

  const result = buildMappingReport(rows, maps, ledger);
  assert.equal(result.report[0]?.mapping_status, "DUPLICATE: Already synced to PDI");
  assert.equal(result.report[0]?.flagEntryDate, "2026-09-13");
  assert.equal(result.report[1]?.mapping_status, "MAPPED");
  assert.equal(result.report[1]?.flagEntryDate, "2026-09-14");
  assert.equal(result.report[2]?.mapping_status, "MAPPED");
  assert.equal(result.report[2]?.flagId, "flag_canvass");
});

test("a stored flag id is a duplicate on that day only", () => {
  const maps = buildMappingMaps(
    mappingOutput([
      {
        key: "Campaign A||Question 1||Support",
        surveyName: "Campaign A",
        stwQuestionName: "Question 1",
        stwAnswerValue: "Support",
        pdiQuestionId: "pdi_q_1",
        pdiAnswerOptionId: "pdi_answer_support",
        pdiFlagId: "Me6YesDvTQI7y3NWr5czXw==",
        pdiFlagCode: "STRONG",
        pdiFlagDesc: "Strong Support",
        confidence: "manual",
        method: "user-selected",
      },
      {
        key: "Campaign A||Canvass Result||Yes",
        surveyName: "Campaign A",
        stwQuestionName: "Canvass Result",
        stwAnswerValue: "Yes",
        pdiQuestionId: "pdi_canvass",
        pdiAnswerOptionId: "pdi_answer_canvass",
        pdiFlagId: "flag_canvass",
        pdiFlagCode: "CANVASS",
        pdiFlagDesc: "Canvass",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "test.json"
  );
  const ledger = new Set<string>();
  addStoredFlagToLedger(ledger, "CA25210293", "Me6YesDvTQI7y3NWr5czXw==", "2026-09-13", maps);
  const rows: SurveyResultRow[] = [
    surveyRow({
      pdi_id: "CA25210293",
      question_name: "Question 1",
      answer_value: "Support",
      call_time: "2026-09-13 18:00:00",
      call_id: "same-flag",
    }),
    surveyRow({
      pdi_id: "CA25210293",
      question_name: "Question 1",
      answer_value: "Support",
      call_time: "2026-09-14 18:00:00",
      call_id: "next-day",
    }),
    surveyRow({
      pdi_id: "CA25210293",
      question_name: "Canvass Result",
      answer_value: "Yes",
      call_time: "2026-09-13 18:00:00",
      call_id: "other-flag",
    }),
  ];

  const result = buildMappingReport(rows, maps, ledger);
  assert.equal(result.report[0]?.mapping_status, "DUPLICATE: Already synced to PDI");
  assert.equal(result.report[0]?.flagId, "Me6YesDvTQI7y3NWr5czXw==");
  assert.equal(result.report[1]?.mapping_status, "MAPPED");
  assert.equal(result.report[1]?.flagEntryDate, "2026-09-14");
  assert.equal(result.report[2]?.mapping_status, "MAPPED");
  assert.equal(result.report[2]?.flagId, "flag_canvass");
});

test("date-range mapping keeps a new day and a different same-day flag, and skips a repost", () => {
  const maps = postedFlagMaps();
  const ledger = new Set([ledgerKey("ca123", "flag_support", "2026-06-01")]);
  const rows: SurveyResultRow[] = [
    surveyRow({
      question_name: "Question 1",
      answer_value: "Support",
      call_time: "2026-06-01 18:00:00",
      pdi_id: "ca123",
      call_id: "already",
    }),
    surveyRow({
      question_name: "Question 1",
      answer_value: "Support",
      call_time: "2026-06-02 18:00:00",
      call_id: "next-day",
    }),
    surveyRow({
      question_name: "Canvass Result",
      answer_value: "Yes",
      call_time: "2026-06-01 18:00:00",
      call_id: "other-flag",
    }),
  ];

  const result = buildMappingReport(rows, maps, ledger);
  assert.equal(result.report[0]?.mapping_status, "DUPLICATE: Already synced to PDI");
  assert.equal(result.report[1]?.mapping_status, "MAPPED");
  assert.equal(result.report[1]?.flagEntryDate, "2026-06-02");
  assert.equal(result.report[2]?.mapping_status, "MAPPED");
  assert.equal(result.report[2]?.flagId, "flag_canvass");
  assert.deepEqual(
    result.payload.map((item) => item.flagId),
    ["flag_support", "flag_canvass"]
  );
  assert.deepEqual(
    result.payload.map((item) => item.flagEntryDate),
    ["2026-06-02", "2026-06-01"]
  );
});
