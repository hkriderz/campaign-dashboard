import test from "node:test";
import assert from "node:assert/strict";
import { TEXT_ACQUISITION_TYPE_ID, TEXT_MAPPING_SURVEY_NAME } from "./channel";
import {
  buildNithyaTextCampaignStwData,
  buildNithyaTextStwData,
  hasMappableTextQuestions,
  normalizeTextSyncRow,
} from "./text-tag-stw-data";
import { buildMappingMaps } from "./sync/mapping";
import { buildMappingReport } from "./sync/sync-reports";
import type { MappingOutput } from "./types";

test("buildNithyaTextStwData keeps raw tag names under Support and Moved", () => {
  const data = buildNithyaTextStwData([
    "NithyaMayorYES",
    "NithyaMayor_SupportBass",
    "NithyaMayor_Undecided",
    "NithyaMayor_Neither",
    "Moved",
    "RandomOtherTag",
    "NithyaMayorYES",
  ]);

  assert.deepEqual(Object.keys(data), [TEXT_MAPPING_SURVEY_NAME]);
  assert.deepEqual(data[TEXT_MAPPING_SURVEY_NAME]?.Support, [
    "NithyaMayorYES",
    "NithyaMayor_Undecided",
    "NithyaMayor_Neither",
    "NithyaMayor_SupportBass",
  ]);
  assert.deepEqual(data[TEXT_MAPPING_SURVEY_NAME]?.Moved, ["Moved"]);
});

test("buildNithyaTextCampaignStwData lists campaigns separately including untagged lists", () => {
  const data = buildNithyaTextCampaignStwData([
    { campaignName: "Nithya Endorsement", tagName: "NithyaMayorYES" },
    { campaignName: "Nithya Endorsement", tagName: "Moved" },
    { campaignName: "Nithya PAC", tagName: "NithyaMayor_Undecided" },
    { campaignName: "Nithya Pending", tagName: "" },
    { campaignName: "Nithya Other Only", tagName: "SomeOtherTag" },
  ]);

  assert.deepEqual(Object.keys(data).sort(), [
    "Nithya Endorsement",
    "Nithya Other Only",
    "Nithya PAC",
    "Nithya Pending",
  ]);
  assert.deepEqual(data["Nithya Endorsement"]?.Support, ["NithyaMayorYES"]);
  assert.deepEqual(data["Nithya Endorsement"]?.Moved, ["Moved"]);
  assert.deepEqual(data["Nithya PAC"]?.Support, ["NithyaMayor_Undecided"]);
  assert.deepEqual(data["Nithya Pending"], {});
  assert.deepEqual(data["Nithya Other Only"], {});
  assert.equal(hasMappableTextQuestions(data["Nithya Endorsement"]), true);
  assert.equal(hasMappableTextQuestions(data["Nithya Pending"]), false);
  assert.equal(hasMappableTextQuestions(data["Nithya Other Only"]), false);
});

test("normalizeTextSyncRow keeps the campaign name and drops Other tags", () => {
  const yes = normalizeTextSyncRow({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA123",
    call_time: "2026-09-03 12:00:00",
  });
  assert.deepEqual(yes, {
    campaign_name: "Nithya PAC",
    question_name: "Support",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA123",
    call_time: "2026-09-03 12:00:00",
  });

  const noCampaign = normalizeTextSyncRow({
    answer_value: "NithyaMayorYES",
    pdi_id: "CA123",
    call_time: "2026-09-03 12:00:00",
  });
  assert.equal(noCampaign?.campaign_name, TEXT_MAPPING_SURVEY_NAME);

  assert.equal(
    normalizeTextSyncRow({ answer_value: "RandomOtherTag", pdi_id: "CA123" }),
    null
  );
  assert.equal(
    normalizeTextSyncRow({ answer_value: "NithyaMayorYES", pdi_id: "" }),
    null
  );
});

test("buildMappingReport maps text rows with the synthetic survey and raw tag", () => {
  const mapping: MappingOutput = {
    schemaVersion: 2,
    generated: "2026-09-06T00:00:00.000Z",
    description: "text test",
    stats: { totalQuestionMappings: 1, totalAnswerMappings: 1, surveys: 1 },
    flagRegistry: [
      {
        flagId: "flag_yes",
        code: "SUPPORT",
        desc: "Strong Support",
        scope: "question-specific",
        usedInNQuestions: 1,
      },
    ],
    questionMappings: [
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        pdiQuestionId: "pdi_q_support",
        mode: "question",
        confidence: "manual",
        method: "user-selected",
      },
    ],
    answerMappings: [
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support||NithyaMayorYES`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        stwAnswerValue: "NithyaMayorYES",
        pdiQuestionId: "pdi_q_support",
        pdiAnswerOptionId: "opt_yes",
        pdiFlagId: "flag_yes",
        pdiFlagCode: "SUPPORT",
        pdiFlagDesc: "Strong Support",
        confidence: "manual",
        method: "user-selected",
      },
    ],
  };

  const maps = buildMappingMaps(mapping, "stw_text_pdi_mapping_test.json");
  const row = normalizeTextSyncRow({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA999",
    call_time: "2026-09-03 10:00:00",
  });
  assert.ok(row);

  const { payload, rowsSkipped } = buildMappingReport(
    [row],
    maps,
    new Set(),
    TEXT_ACQUISITION_TYPE_ID,
    TEXT_MAPPING_SURVEY_NAME
  );
  assert.equal(rowsSkipped, 0);
  assert.equal(payload.length, 1);
  assert.equal(payload[0]?.pdiId, "CA999");
  assert.equal(payload[0]?.flagId, "flag_yes");
  assert.equal(payload[0]?.questionId, "pdi_q_support");
  assert.equal(payload[0]?.acquisitionTypeId, TEXT_ACQUISITION_TYPE_ID);
  assert.notEqual(payload[0]?.acquisitionTypeId, "w6we79BXkuCsBbb9QCyiLA==");
});

test("buildMappingReport prefers a per-campaign text mapping over the shared survey", () => {
  const mapping: MappingOutput = {
    schemaVersion: 2,
    generated: "2026-09-09T00:00:00.000Z",
    description: "text override test",
    stats: { totalQuestionMappings: 2, totalAnswerMappings: 2, surveys: 2 },
    flagRegistry: [
      {
        flagId: "flag_shared",
        code: "SHARED",
        desc: "Shared",
        scope: "question-specific",
        usedInNQuestions: 1,
      },
      {
        flagId: "flag_pac",
        code: "PAC",
        desc: "PAC only",
        scope: "question-specific",
        usedInNQuestions: 1,
      },
    ],
    questionMappings: [
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        pdiQuestionId: "pdi_shared",
        mode: "question",
        confidence: "manual",
        method: "user-selected",
      },
      {
        key: "Nithya PAC||Support",
        surveyName: "Nithya PAC",
        stwQuestionName: "Support",
        pdiQuestionId: "pdi_pac",
        mode: "question",
        confidence: "manual",
        method: "user-selected",
      },
    ],
    answerMappings: [
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support||NithyaMayorYES`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        stwAnswerValue: "NithyaMayorYES",
        pdiQuestionId: "pdi_shared",
        pdiAnswerOptionId: "opt_shared",
        pdiFlagId: "flag_shared",
        pdiFlagCode: "SHARED",
        pdiFlagDesc: "Shared",
        confidence: "manual",
        method: "user-selected",
      },
      {
        key: "Nithya PAC||Support||NithyaMayorYES",
        surveyName: "Nithya PAC",
        stwQuestionName: "Support",
        stwAnswerValue: "NithyaMayorYES",
        pdiQuestionId: "pdi_pac",
        pdiAnswerOptionId: "opt_pac",
        pdiFlagId: "flag_pac",
        pdiFlagCode: "PAC",
        pdiFlagDesc: "PAC only",
        confidence: "manual",
        method: "user-selected",
      },
    ],
  };

  const maps = buildMappingMaps(mapping, "stw_text_pdi_mapping_override.json");
  const pac = normalizeTextSyncRow({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA1",
    call_time: "2026-09-03 10:00:00",
  });
  const hwlra = normalizeTextSyncRow({
    campaign_name: "Nithya HWLRA",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA2",
    call_time: "2026-09-03 10:00:00",
  });
  assert.ok(pac);
  assert.ok(hwlra);

  const { payload } = buildMappingReport(
    [pac, hwlra],
    maps,
    new Set(),
    TEXT_ACQUISITION_TYPE_ID,
    TEXT_MAPPING_SURVEY_NAME
  );
  assert.equal(payload.length, 2);
  assert.equal(payload[0]?.flagId, "flag_pac");
  assert.equal(payload[0]?.questionId, "pdi_pac");
  assert.equal(payload[1]?.flagId, "flag_shared");
  assert.equal(payload[1]?.questionId, "pdi_shared");
});
