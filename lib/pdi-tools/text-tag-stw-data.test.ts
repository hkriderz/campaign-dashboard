import test from "node:test";
import assert from "node:assert/strict";
import { TEXT_ACQUISITION_TYPE_ID, TEXT_MAPPING_SURVEY_NAME } from "./channel";
import {
  buildNithyaTextCampaignStwData,
  buildNithyaTextStwData,
  hasMappableTextQuestions,
  normalizeTextSyncRow,
} from "./text-tag-stw-data";
import { buildTextTagCatalogQuery, buildTextTagQuery } from "./sync/text-query";
import { autoMatchAnswer } from "./auto-match";
import { collapseTextRowsToLatestStatus } from "./sync/collapse-text";
import { buildMappingMaps } from "./sync/mapping";
import { buildMappingReport } from "./sync/sync-reports";
import type { MappingOutput, PdiAnswerOption } from "./types";

test("buildNithyaTextStwData collapses raw tags to support statuses", () => {
  const data = buildNithyaTextStwData([
    "NithyaMayorYES",
    "NithyaMayor_YES",
    "NithyaMayor_SupportBass",
    "NithyaMayor_Undecided",
    "NithyaMayor_Neither",
    "Moved",
    "Moved2026",
    "RandomOtherTag",
    "NithyaMayorYES",
  ]);

  assert.deepEqual(Object.keys(data), [TEXT_MAPPING_SURVEY_NAME]);
  assert.deepEqual(data[TEXT_MAPPING_SURVEY_NAME]?.Support, [
    "Strong Support",
    "Undecided",
    "Neither",
    "Strong Oppose",
  ]);
  assert.deepEqual(data[TEXT_MAPPING_SURVEY_NAME]?.Moved, ["Recently moved"]);
  assert.deepEqual(data[TEXT_MAPPING_SURVEY_NAME]?.Other, ["RandomOtherTag"]);
});

test("buildNithyaTextCampaignStwData lists every tagged campaign and keeps other tags", () => {
  const data = buildNithyaTextCampaignStwData([
    { campaignName: "Nithya Endorsement", tagName: "NithyaMayorYES" },
    { campaignName: "Nithya Endorsement", tagName: "Moved" },
    { campaignName: "Nithya PAC", tagName: "NithyaMayor_Undecided" },
    { campaignName: "Nithya Pending", tagName: "" },
    { campaignName: "School Board GOTV", tagName: "OptOut" },
  ]);

  assert.deepEqual(Object.keys(data).sort(), [
    "Nithya Endorsement",
    "Nithya PAC",
    "School Board GOTV",
  ]);
  assert.deepEqual(data["Nithya Endorsement"]?.Support, ["Strong Support"]);
  assert.deepEqual(data["Nithya Endorsement"]?.Moved, ["Recently moved"]);
  assert.deepEqual(data["Nithya PAC"]?.Support, ["Undecided"]);
  assert.deepEqual(data["School Board GOTV"]?.Other, ["OptOut"]);
  assert.equal(hasMappableTextQuestions(data["Nithya Endorsement"]), true);
  assert.equal(hasMappableTextQuestions(data["School Board GOTV"]), true);
  assert.equal(data["Nithya Pending"], undefined);
});

test("text mapper catalog lists every tagged text campaign with no name or date cutoff", () => {
  const sql = buildTextTagCatalogQuery();
  assert.match(sql, /l11_stw_txt\.campaigns/);
  assert.match(sql, /campaign_contact_tags/);
  assert.match(sql, /JOIN `[^`]+` AS tags/);
  assert.match(sql, /tags\.name IS NOT NULL/);
  assert.doesNotMatch(sql, /nithya/i);
  assert.doesNotMatch(sql, /2025-12-01/);
  assert.doesNotMatch(sql, /created_at/);
});

test("text sync query includes every tagged campaign in the sync window", () => {
  const sql = buildTextTagQuery("2026-09-01T00:00:00", "2026-09-02T00:00:00");
  assert.match(sql, /campaign_contact_tags/);
  assert.match(sql, /call_time >= '2026-09-01 00:00:00'/);
  assert.doesNotMatch(sql, /nithya/i);
  assert.doesNotMatch(sql, /2025-12-01/);
});

test("normalizeTextSyncRow writes classified status and keeps the raw tag", () => {
  const yes = normalizeTextSyncRow({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA123",
    call_time: "2026-09-03 12:00:00",
  });
  assert.deepEqual(yes, {
    campaign_name: "Nithya PAC",
    question_name: "Support",
    answer_value: "Strong Support",
    pdi_id: "CA123",
    call_time: "2026-09-03 12:00:00",
    _source_answer: "NithyaMayorYES",
  });

  const noCampaign = normalizeTextSyncRow({
    answer_value: "NithyaMayorYES",
    pdi_id: "CA123",
    call_time: "2026-09-03 12:00:00",
  });
  assert.equal(noCampaign?.campaign_name, TEXT_MAPPING_SURVEY_NAME);
  assert.equal(noCampaign?.answer_value, "Strong Support");
  assert.equal(noCampaign?._source_answer, "NithyaMayorYES");

  assert.deepEqual(
    normalizeTextSyncRow({
      campaign_name: "School Board GOTV",
      answer_value: "RandomOtherTag",
      pdi_id: "CA123",
      call_time: "2026-09-03 12:00:00",
    }),
    {
      campaign_name: "School Board GOTV",
      question_name: "Other",
      answer_value: "RandomOtherTag",
      pdi_id: "CA123",
      call_time: "2026-09-03 12:00:00",
      _source_answer: "RandomOtherTag",
    }
  );
  assert.equal(
    normalizeTextSyncRow({ answer_value: "NithyaMayorYES", pdi_id: "" }),
    null
  );
});

function supportMapping(answers: MappingOutput["answerMappings"]): MappingOutput {
  return {
    schemaVersion: 2,
    generated: "2026-09-06T00:00:00.000Z",
    description: "text test",
    stats: { totalQuestionMappings: 1, totalAnswerMappings: answers.length, surveys: 1 },
    flagRegistry: [
      {
        flagId: "flag_yes",
        code: "SS",
        desc: "Strong Support",
        scope: "generic",
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
    answerMappings: answers,
  };
}

test("buildMappingReport maps classified Strong Support onto the Support ID", () => {
  const maps = buildMappingMaps(
    supportMapping([
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support||Strong Support`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        stwAnswerValue: "Strong Support",
        pdiQuestionId: "pdi_q_support",
        pdiAnswerOptionId: "opt_yes",
        pdiFlagId: "flag_yes",
        pdiFlagCode: "SS",
        pdiFlagDesc: "Strong Support",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "stw_text_pdi_mapping_status.json"
  );
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
});

test("buildMappingReport falls back to a raw-tag mapping from older exports", () => {
  const maps = buildMappingMaps(
    supportMapping([
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support||NithyaMayorYES`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        stwAnswerValue: "NithyaMayorYES",
        pdiQuestionId: "pdi_q_support",
        pdiAnswerOptionId: "opt_yes",
        pdiFlagId: "flag_yes",
        pdiFlagCode: "SS",
        pdiFlagDesc: "Strong Support",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "stw_text_pdi_mapping_raw.json"
  );
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
  assert.equal(payload[0]?.flagId, "flag_yes");
  assert.equal(payload[0]?.questionId, "pdi_q_support");
});

test("buildMappingReport reuses a mapped tag that classifies to the same status", () => {
  const maps = buildMappingMaps(
    supportMapping([
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support||NithyaMayorYES`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        stwAnswerValue: "NithyaMayorYES",
        pdiQuestionId: "pdi_q_support",
        pdiAnswerOptionId: "opt_yes",
        pdiFlagId: "flag_yes",
        pdiFlagCode: "SS",
        pdiFlagDesc: "Strong Support",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "stw_text_pdi_mapping_variant.json"
  );
  const row = normalizeTextSyncRow({
    campaign_name: "Nithya PAC",
    answer_value: "NithyaMayor_YES",
    pdi_id: "CA888",
    call_time: "2026-09-03 10:00:00",
  });
  assert.ok(row);
  assert.equal(row.answer_value, "Strong Support");
  assert.equal(row._source_answer, "NithyaMayor_YES");

  const { payload, rowsSkipped } = buildMappingReport(
    [row],
    maps,
    new Set(),
    TEXT_ACQUISITION_TYPE_ID,
    TEXT_MAPPING_SURVEY_NAME
  );
  assert.equal(rowsSkipped, 0);
  assert.equal(payload.length, 1);
  assert.equal(payload[0]?.flagId, "flag_yes");
  assert.equal(payload[0]?.questionId, "pdi_q_support");
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

test("buildMappingReport posts one Support flag after latest-status collapse", () => {
  const maps = buildMappingMaps(
    supportMapping([
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support||Strong Support`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        stwAnswerValue: "Strong Support",
        pdiQuestionId: "pdi_q_support",
        pdiAnswerOptionId: "opt_yes",
        pdiFlagId: "flag_yes",
        pdiFlagCode: "SS",
        pdiFlagDesc: "Strong Support",
        confidence: "manual",
        method: "user-selected",
      },
      {
        key: `${TEXT_MAPPING_SURVEY_NAME}||Support||Undecided`,
        surveyName: TEXT_MAPPING_SURVEY_NAME,
        stwQuestionName: "Support",
        stwAnswerValue: "Undecided",
        pdiQuestionId: "pdi_q_support",
        pdiAnswerOptionId: "opt_u",
        pdiFlagId: "flag_u",
        pdiFlagCode: "U",
        pdiFlagDesc: "Undecided",
        confidence: "manual",
        method: "user-selected",
      },
    ]),
    "stw_text_pdi_mapping_collapse.json"
  );
  const yes = normalizeTextSyncRow({
    campaign_name: "Nithya Endorsement Announcement 9/1/26 - UH Local 11 PAC",
    answer_value: "NithyaMayorYES",
    pdi_id: "CA18678463",
    call_time: "2026-09-02 10:00:00",
  });
  const undecided = normalizeTextSyncRow({
    campaign_name: "Nithya Endorsement Announcement 9/1/26 - UH Local 11 PAC",
    answer_value: "NithyaMayor_Undecided",
    pdi_id: "CA18678463",
    call_time: "2026-09-03 10:00:00",
  });
  assert.ok(yes);
  assert.ok(undecided);

  const { rows } = collapseTextRowsToLatestStatus([yes, undecided]);
  const { payload, report } = buildMappingReport(
    rows,
    maps,
    new Set(),
    TEXT_ACQUISITION_TYPE_ID,
    TEXT_MAPPING_SURVEY_NAME
  );
  assert.equal(report.length, 1);
  assert.equal(payload.length, 1);
  assert.equal(payload[0]?.pdiId, "CA18678463");
  assert.equal(payload[0]?.flagId, "flag_u");
  assert.equal(report[0]?.answer_value, "Undecided");
});

test("autoMatchAnswer maps text statuses onto PDI Support ID options", () => {
  const options: PdiAnswerOption[] = [
    {
      id: "opt_ss",
      flagId: "flag_ss",
      flagIdDescription: "Strong Support",
      displayDescription: "Strong Support",
      displayCode: "SS",
    },
    {
      id: "opt_u",
      flagId: "flag_u",
      flagIdDescription: "Undecided",
      displayDescription: "Undecided",
      displayCode: "U",
    },
    {
      id: "opt_so",
      flagId: "flag_so",
      flagIdDescription: "Strong Oppose",
      displayDescription: "Strong Oppose",
      displayCode: "SO",
    },
  ];

  assert.equal(autoMatchAnswer("Strong Support", options)?.option.displayCode, "SS");
  assert.equal(autoMatchAnswer("Undecided", options)?.option.displayCode, "U");
  assert.equal(autoMatchAnswer("Neither", options)?.option.displayCode, "U");
  assert.equal(autoMatchAnswer("Strong Oppose", options)?.option.displayCode, "SO");
  assert.equal(autoMatchAnswer("NithyaMayorYES", options), null);
});
