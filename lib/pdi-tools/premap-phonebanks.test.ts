import test from "node:test";
import assert from "node:assert/strict";
import { premapPhonebanks } from "./premap-phonebanks";
import type { PdiAnswerOption, PdiQuestion } from "./types";

function option(code: string): PdiAnswerOption {
  return {
    id: `opt-${code}`,
    flagId: `flag-${code}`,
    flagIdDescription: code,
    displayDescription: code,
    displayCode: code,
  };
}

function question(partial: Pick<PdiQuestion, "id" | "question" | "candidate"> & Partial<PdiQuestion>): PdiQuestion {
  return {
    organizationName: "org",
    questionLabel: partial.question,
    questionDescription: "",
    type: "Candidate Campaign",
    category: "",
    default: false,
    answerOptions: [option("SS"), option("U"), option("SO")],
    ...partial,
  };
}

const canvass = question({
  id: "pdi-canvass",
  question: "Non-Contact Online Phone Bank",
  candidate: "",
  answerOptions: [option("Talking to correct person"), option("Declined conversation")],
});

const nithya = question({
  id: "pdi-nithya",
  question: "Nithya Raman Support",
  candidate: "Nithya Raman",
});

const nithyaId = question({
  id: "pdi-nithya-id",
  question: "Nithya Raman ID",
  candidate: "Nithya Raman",
});

const erickson = question({
  id: "pdi-erickson",
  question: "Erickson Support",
  candidate: "Erickson",
});

const prop40 = question({
  id: "pdi-prop-40",
  question: "Support Prop 40?",
  candidate: "",
});

const slate = question({
  id: "pdi-slate",
  question: "Progressive Slate",
  candidate: "",
});

const nithyaTag = { id: "nithya", label: "Nithya Raman", searchTerms: ["nithya"] };
const ericksonTag = { id: "erickson", label: "Erickson", searchTerms: ["erickson"] };

test("final result maps to the only question for that phonebank candidate", () => {
  const result = premapPhonebanks({
    campaigns: [{ campaignName: "Nithya PB 10/7", tag: nithyaTag }],
    scope: "tags",
    stwData: {
      "Nithya PB 10/7": {
        "Canvass Result": ["Talking to correct person"],
        "3. Final Result": ["SS", "U"],
        "1. Progressive Slate": ["SS"],
      },
    },
    pdiQuestions: [canvass, nithya, prop40, slate],
    questionMappings: {},
    answerMappings: {},
  });

  assert.deepEqual(result.summary.included, ["Nithya PB 10/7"]);
  assert.equal(result.questionMappings["Nithya PB 10/7||Canvass Result"]?.pdiQuestionId, "pdi-canvass");
  assert.equal(result.questionMappings["Nithya PB 10/7||3. Final Result"]?.pdiQuestionId, "pdi-nithya");
  assert.equal(result.answerMappings["Nithya PB 10/7||3. Final Result||SS"]?.pdiFlagId, "flag-SS");
  assert.equal(result.questionMappings["Nithya PB 10/7||1. Progressive Slate"], undefined);
});

test("prop 40 maps to the proposition question and not the slate", () => {
  const result = premapPhonebanks({
    campaigns: [{ campaignName: "Lynwood PB 10/7", tag: nithyaTag }],
    scope: "tags",
    stwData: {
      "Lynwood PB 10/7": {
        "2. Support Prop 40? / Apoya la Prop 40?": ["SS"],
        "1. Progressive Slate": ["SS"],
      },
    },
    pdiQuestions: [canvass, nithya, prop40, slate],
    questionMappings: {},
    answerMappings: {},
  });

  assert.equal(
    result.questionMappings["Lynwood PB 10/7||2. Support Prop 40? / Apoya la Prop 40?"]?.pdiQuestionId,
    "pdi-prop-40"
  );
  assert.equal(result.questionMappings["Lynwood PB 10/7||1. Progressive Slate"], undefined);
});

test("two candidate questions leave final result blank", () => {
  const result = premapPhonebanks({
    campaigns: [{ campaignName: "Nithya PB", tag: nithyaTag }],
    scope: "tags",
    stwData: {
      "Nithya PB": {
        "Final Result": ["SS"],
      },
    },
    pdiQuestions: [nithya, nithyaId],
    questionMappings: {},
    answerMappings: {},
  });

  assert.equal(result.questionMappings["Nithya PB||Final Result"], undefined);
});

test("a different phonebank does not receive Nithya's question", () => {
  const result = premapPhonebanks({
    campaigns: [{ campaignName: "Erickson PB", tag: ericksonTag }],
    scope: "tags",
    stwData: {
      "Erickson PB": {
        "Resultado final": ["SS"],
      },
    },
    pdiQuestions: [nithya, erickson],
    questionMappings: {},
    answerMappings: {},
  });

  assert.equal(result.questionMappings["Erickson PB||Resultado final"]?.pdiQuestionId, "pdi-erickson");
});

test("campaign tags mode drops an untagged phonebank and all-campaigns mode keeps canvass and props", () => {
  const campaigns = [
    { campaignName: "Volunteer Night", tag: null },
    { campaignName: "Nithya PB", tag: nithyaTag },
  ];
  const stwData = {
    "Volunteer Night": {
      "Canvass Result": ["Declined conversation"],
      "Support Proposition 40": ["U"],
      "Final Result": ["SS"],
    },
    "Nithya PB": {
      "Final Result": ["SS"],
    },
  };
  const pdiQuestions = [canvass, nithya, prop40];

  const tagged = premapPhonebanks({
    campaigns,
    scope: "tags",
    stwData,
    pdiQuestions,
    questionMappings: {},
    answerMappings: {},
  });
  assert.deepEqual(tagged.summary.included, ["Nithya PB"]);
  assert.equal(tagged.summary.skippedUntagged, 1);
  assert.equal(tagged.questionMappings["Volunteer Night||Canvass Result"], undefined);

  const all = premapPhonebanks({
    campaigns,
    scope: "all",
    stwData,
    pdiQuestions,
    questionMappings: {},
    answerMappings: {},
  });
  assert.deepEqual(all.summary.included, ["Nithya PB", "Volunteer Night"]);
  assert.equal(all.questionMappings["Volunteer Night||Canvass Result"]?.pdiQuestionId, "pdi-canvass");
  assert.equal(all.questionMappings["Volunteer Night||Support Proposition 40"]?.pdiQuestionId, "pdi-prop-40");
  assert.equal(all.questionMappings["Volunteer Night||Final Result"], undefined);
  assert.equal(all.questionMappings["Nithya PB||Final Result"]?.pdiQuestionId, "pdi-nithya");
});

test("a question with no candidate name does not throw", () => {
  const blank = question({ id: "pdi-blank", question: "Untitled", candidate: "" });
  blank.candidate = null as unknown as string;
  const result = premapPhonebanks({
    campaigns: [{ campaignName: "Nithya PB", tag: nithyaTag }],
    scope: "tags",
    stwData: { "Nithya PB": { "Final Result": ["SS"] } },
    pdiQuestions: [nithya, blank],
    questionMappings: {},
    answerMappings: {},
  });
  assert.equal(result.questionMappings["Nithya PB||Final Result"]?.pdiQuestionId, "pdi-nithya");
});

test("an existing question mapping is kept", () => {
  const result = premapPhonebanks({
    campaigns: [{ campaignName: "Nithya PB", tag: nithyaTag }],
    scope: "tags",
    stwData: {
      "Nithya PB": {
        "Final Result": ["SS"],
      },
    },
    pdiQuestions: [nithya, erickson],
    questionMappings: {
      "Nithya PB||Final Result": {
        pdiQuestionId: "pdi-erickson",
        mode: "question",
        confidence: "manual",
        method: "user-selected",
      },
    },
    answerMappings: {},
  });

  assert.equal(result.questionMappings["Nithya PB||Final Result"]?.pdiQuestionId, "pdi-erickson");
});
