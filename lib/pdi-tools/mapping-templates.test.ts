import test from "node:test";
import assert from "node:assert/strict";
import { TEXT_MAPPING_SURVEY_NAME } from "./channel";
import {
  applyTemplatesToSurvey,
  buildQuestionTemplate,
  campaignNamesSimilar,
  deleteQuestionTemplate,
  parseQuestionTemplates,
  templateStorageKey,
  type QuestionTemplate,
} from "./mapping-templates";
import type { AnswerMappings, PdiQuestion, QuestionMappings } from "./types";

const supportQuestion: PdiQuestion = {
  id: "pdi_support",
  organizationName: "org",
  question: "Nithya Support",
  questionLabel: "Nithya Support",
  questionDescription: "",
  type: "Candidate Campaign",
  category: "",
  candidate: "Nithya",
  default: false,
  answerOptions: [
    {
      id: "opt_yes",
      flagId: "flag_yes",
      flagIdDescription: "Yes",
      displayDescription: "Yes",
      displayCode: "YES",
    },
    {
      id: "opt_no",
      flagId: "flag_no",
      flagIdDescription: "No",
      displayDescription: "No",
      displayCode: "NO",
    },
  ],
};

const savedSupport: QuestionTemplate = {
  sourceSurveyName: "Nithya PAC",
  pdiQuestionId: "pdi_support",
  answers: {
    NithyaMayorYES: {
      pdiQuestionId: "pdi_support",
      pdiAnswerOptionId: "opt_yes",
      pdiFlagId: "flag_yes",
      pdiFlagCode: "YES",
      pdiFlagDesc: "Yes",
    },
  },
};

test("campaignNamesSimilar matches Nithya variants and containment", () => {
  assert.equal(campaignNamesSimilar("Nithya PAC", "Nithya PAC"), true);
  assert.equal(campaignNamesSimilar("Nithya PAC", "Nithya HWLRA"), true);
  assert.equal(
    campaignNamesSimilar("Nithya Endorsement Announcement", "Nithya Endorsement"),
    true
  );
  assert.equal(campaignNamesSimilar("Nithya PAC", "School Board GOTV"), false);
  assert.equal(campaignNamesSimilar("Nithya PAC", "Bass Endorsement"), false);
  assert.equal(campaignNamesSimilar("STW Text Phone Bank", "STW Dialer Phone Bank"), false);
});

test("template storage keys stay isolated by channel", () => {
  assert.equal(
    templateStorageKey("dialer"),
    "campaign_dashboard_pdi_mapper_templates_dialer_v1"
  );
  assert.equal(
    templateStorageKey("text"),
    "campaign_dashboard_pdi_mapper_templates_text_v1"
  );
  assert.notEqual(templateStorageKey("dialer"), templateStorageKey("text"));
});

test("buildQuestionTemplate snapshots the display campaign name", () => {
  const questionMappings: QuestionMappings = {
    [`${TEXT_MAPPING_SURVEY_NAME}||Support`]: {
      pdiQuestionId: "pdi_support",
      mode: "question",
      confidence: "manual",
      method: "user-selected",
    },
  };
  const answerMappings: AnswerMappings = {
    [`${TEXT_MAPPING_SURVEY_NAME}||Support||NithyaMayorYES`]: {
      pdiQuestionId: "pdi_support",
      pdiAnswerOptionId: "opt_yes",
      pdiFlagId: "flag_yes",
      pdiFlagCode: "YES",
      pdiFlagDesc: "Yes",
      confidence: "manual",
      method: "user-selected",
    },
  };
  const template = buildQuestionTemplate({
    displaySurveyName: "Nithya PAC",
    writeSurveyName: TEXT_MAPPING_SURVEY_NAME,
    questionName: "Support",
    questionMappings,
    answerMappings,
    answers: ["NithyaMayorYES"],
  });
  assert.ok(template);
  assert.equal(template.sourceSurveyName, "Nithya PAC");
  assert.equal(template.pdiQuestionId, "pdi_support");
  assert.equal(template.answers.NithyaMayorYES?.pdiFlagId, "flag_yes");
});

test("applyTemplatesToSurvey copies a saved mapping onto a similar campaign", () => {
  const { questionMappings, answerMappings } = applyTemplatesToSurvey({
    displaySurveyName: "Nithya HWLRA",
    writeSurveyName: "Nithya HWLRA",
    surveyQuestions: { Support: ["NithyaMayorYES"] },
    templates: { Support: savedSupport },
    questionMappings: {},
    answerMappings: {},
    pdiQuestions: [supportQuestion],
  });
  assert.equal(questionMappings["Nithya HWLRA||Support"]?.pdiQuestionId, "pdi_support");
  assert.equal(questionMappings["Nithya HWLRA||Support"]?.confidence, "auto");
  assert.equal(answerMappings["Nithya HWLRA||Support||NithyaMayorYES"]?.pdiFlagId, "flag_yes");
});

test("applyTemplatesToSurvey uses the All-lists write identity", () => {
  const { questionMappings, answerMappings } = applyTemplatesToSurvey({
    displaySurveyName: "Nithya HWLRA",
    writeSurveyName: TEXT_MAPPING_SURVEY_NAME,
    surveyQuestions: { Support: ["NithyaMayorYES"] },
    templates: { Support: savedSupport },
    questionMappings: {},
    answerMappings: {},
    pdiQuestions: [supportQuestion],
  });
  assert.equal(
    questionMappings[`${TEXT_MAPPING_SURVEY_NAME}||Support`]?.pdiQuestionId,
    "pdi_support"
  );
  assert.equal(questionMappings["Nithya HWLRA||Support"], undefined);
  assert.equal(
    answerMappings[`${TEXT_MAPPING_SURVEY_NAME}||Support||NithyaMayorYES`]?.pdiAnswerOptionId,
    "opt_yes"
  );
});

test("applyTemplatesToSurvey skips a question that is already mapped", () => {
  const { questionMappings, answerMappings } = applyTemplatesToSurvey({
    displaySurveyName: "Nithya HWLRA",
    writeSurveyName: "Nithya HWLRA",
    surveyQuestions: { Support: ["NithyaMayorYES"] },
    templates: { Support: savedSupport },
    questionMappings: {
      "Nithya HWLRA||Support": {
        pdiQuestionId: "pdi_other",
        mode: "question",
        confidence: "manual",
        method: "user-selected",
      },
    },
    answerMappings: {
      "Nithya HWLRA||Support||NithyaMayorYES": {
        pdiQuestionId: "pdi_other",
        pdiAnswerOptionId: "opt_other",
        pdiFlagId: "flag_other",
        pdiFlagCode: "OTHER",
        pdiFlagDesc: "Other",
        confidence: "manual",
        method: "user-selected",
      },
    },
    pdiQuestions: [supportQuestion],
  });
  assert.equal(questionMappings["Nithya HWLRA||Support"]?.pdiQuestionId, "pdi_other");
  assert.equal(answerMappings["Nithya HWLRA||Support||NithyaMayorYES"]?.pdiFlagId, "flag_other");
});

test("applyTemplatesToSurvey skips an unrelated campaign title", () => {
  const { questionMappings } = applyTemplatesToSurvey({
    displaySurveyName: "School Board GOTV",
    writeSurveyName: "School Board GOTV",
    surveyQuestions: { Support: ["NithyaMayorYES"] },
    templates: { Support: savedSupport },
    questionMappings: {},
    answerMappings: {},
    pdiQuestions: [supportQuestion],
  });
  assert.equal(questionMappings["School Board GOTV||Support"], undefined);
});

test("deleteQuestionTemplate removes only the template", () => {
  const templates = { Support: savedSupport, Moved: { ...savedSupport, pdiQuestionId: "pdi_moved" } };
  const questionMappings: QuestionMappings = {
    "Nithya PAC||Support": {
      pdiQuestionId: "pdi_support",
      mode: "question",
      confidence: "manual",
      method: "user-selected",
    },
  };
  const next = deleteQuestionTemplate(templates, "Support");
  assert.equal(next.Support, undefined);
  assert.ok(next.Moved);
  assert.equal(questionMappings["Nithya PAC||Support"]?.pdiQuestionId, "pdi_support");
});

test("parseQuestionTemplates ignores malformed entries", () => {
  const parsed = parseQuestionTemplates({
    Support: savedSupport,
    Bad: { sourceSurveyName: "", pdiQuestionId: "x" },
    AlsoBad: "nope",
  });
  assert.ok(parsed.Support);
  assert.equal(parsed.Bad, undefined);
  assert.equal(parsed.AlsoBad, undefined);
});
