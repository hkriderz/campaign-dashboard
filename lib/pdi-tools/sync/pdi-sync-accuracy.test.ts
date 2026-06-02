import test from "node:test";
import assert from "node:assert/strict";
import type { MappingOutput } from "@/lib/pdi-tools/types";
import { normalizeIsoDateRange } from "@/lib/validation/iso-date";
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
