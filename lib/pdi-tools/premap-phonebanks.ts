import { autoMatchAllAnswers } from "./auto-match";
import { applyTemplatesToSurvey, type QuestionTemplates } from "./mapping-templates";
import type {
  AnswerMappings,
  PdiQuestion,
  QuestionMappings,
  StwData,
} from "./types";

export type PhonebankMapScope = "tags" | "all";

/** The tag fields needed to attach Final Result to one candidate. */
export type PhonebankTagMatch = {
  id: string;
  label: string;
  searchTerms?: string[];
};

export type PhonebankForPremap = {
  campaignName: string;
  tag: PhonebankTagMatch | null;
};

export type PhonebankPremapSummary = {
  scope: PhonebankMapScope;
  included: string[];
  missingFromSurveys: string[];
  skippedUntagged: number;
};

const CANVASS_STW_QUESTION = "Canvass Result";
const CANVASS_PDI_QUESTION = "Non-Contact Online Phone Bank";
const PROP_PATTERN = /\bprop(?:osition)?\.?\s*(\d+)\b/i;

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function propNumberInText(text: string): string | null {
  return PROP_PATTERN.exec(text)?.[1] ?? null;
}

export function isFinalResultQuestionName(questionName: string): boolean {
  const name = questionName.toLowerCase();
  return name.includes("final result") || name.includes("resultado final");
}

function pdiQuestionText(question: PdiQuestion): string {
  return [question.question, question.questionLabel, question.questionDescription]
    .map((part) => part ?? "")
    .join(" ");
}

function candidateMatchesTag(candidate: string | null | undefined, tag: PhonebankTagMatch): boolean {
  const value = normalize(candidate);
  if (!value) return false;
  const label = normalize(tag.label);
  if (label && (value === label || value.includes(label) || label.includes(value))) return true;
  const id = normalize(tag.id);
  if (id && (value === id || value.includes(id))) return true;
  for (const term of tag.searchTerms ?? []) {
    const normalized = normalize(term);
    if (normalized.length >= 4 && (value === normalized || value.includes(normalized))) return true;
  }
  return false;
}

function mapQuestionAnswers(args: {
  surveyName: string;
  questionName: string;
  answers: string[];
  pdiQuestion: PdiQuestion;
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
}): void {
  const questionKey = `${args.surveyName}||${args.questionName}`;
  if (args.questionMappings[questionKey]) return;
  args.questionMappings[questionKey] = {
    pdiQuestionId: args.pdiQuestion.id,
    mode: "question",
    confidence: "auto",
    method: "desc-match",
  };
  const matches = autoMatchAllAnswers(args.answers, args.pdiQuestion.answerOptions);
  for (const [answerValue, match] of Object.entries(matches)) {
    const answerKey = `${args.surveyName}||${args.questionName}||${answerValue}`;
    if (args.answerMappings[answerKey]) continue;
    args.answerMappings[answerKey] = {
      pdiQuestionId: args.pdiQuestion.id,
      pdiAnswerOptionId: match.option.id,
      pdiFlagId: match.option.flagId,
      pdiFlagCode: match.option.displayCode,
      pdiFlagDesc: match.option.displayDescription,
      confidence: match.confidence,
      method: match.method,
    };
  }
}

export function selectPhonebanksForPremap(
  campaigns: PhonebankForPremap[],
  scope: PhonebankMapScope
): { selected: PhonebankForPremap[]; skippedUntagged: number } {
  const byName = new Map<string, PhonebankForPremap>();
  let skippedUntagged = 0;
  for (const campaign of campaigns) {
    const name = campaign.campaignName.trim();
    if (!name || byName.has(name)) continue;
    if (scope === "tags" && !campaign.tag) {
      skippedUntagged += 1;
      continue;
    }
    byName.set(name, { campaignName: name, tag: campaign.tag });
  }
  return { selected: [...byName.values()], skippedUntagged };
}

/**
 * Premap canvass result, a single candidate Final Result, and a single proposition
 * question for the phonebanks in scope. Existing question mappings are left as they are.
 */
export function premapPhonebanks(args: {
  campaigns: PhonebankForPremap[];
  scope: PhonebankMapScope;
  stwData: StwData;
  pdiQuestions: PdiQuestion[];
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
  questionTemplates?: QuestionTemplates;
}): {
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
  summary: PhonebankPremapSummary;
} {
  const questionMappings = { ...args.questionMappings };
  const answerMappings = { ...args.answerMappings };
  const { selected, skippedUntagged } = selectPhonebanksForPremap(args.campaigns, args.scope);
  const canvassPdi = args.pdiQuestions.find((question) => question.question === CANVASS_PDI_QUESTION);
  const included: string[] = [];
  const missingFromSurveys: string[] = [];

  for (const campaign of selected) {
    const questions = args.stwData[campaign.campaignName];
    if (!questions) {
      missingFromSurveys.push(campaign.campaignName);
      continue;
    }
    included.push(campaign.campaignName);

    const canvassAnswers = questions[CANVASS_STW_QUESTION];
    if (canvassAnswers && canvassPdi) {
      mapQuestionAnswers({
        surveyName: campaign.campaignName,
        questionName: CANVASS_STW_QUESTION,
        answers: canvassAnswers,
        pdiQuestion: canvassPdi,
        questionMappings,
        answerMappings,
      });
    }

    const candidateQuestions = campaign.tag
      ? args.pdiQuestions.filter(
          (question) =>
            candidateMatchesTag(question.candidate, campaign.tag!) &&
            !propNumberInText(pdiQuestionText(question))
        )
      : [];
    const candidateQuestion = candidateQuestions.length === 1 ? candidateQuestions[0] : undefined;

    for (const [questionName, answers] of Object.entries(questions)) {
      if (questionName === CANVASS_STW_QUESTION) continue;

      const propNumber = propNumberInText(questionName);
      if (propNumber) {
        const propQuestions = args.pdiQuestions.filter(
          (question) => propNumberInText(pdiQuestionText(question)) === propNumber
        );
        if (propQuestions.length === 1) {
          mapQuestionAnswers({
            surveyName: campaign.campaignName,
            questionName,
            answers,
            pdiQuestion: propQuestions[0]!,
            questionMappings,
            answerMappings,
          });
        }
        continue;
      }

      if (candidateQuestion && isFinalResultQuestionName(questionName)) {
        mapQuestionAnswers({
          surveyName: campaign.campaignName,
          questionName,
          answers,
          pdiQuestion: candidateQuestion,
          questionMappings,
          answerMappings,
        });
      }
    }

    if (args.questionTemplates) {
      const applied = applyTemplatesToSurvey({
        displaySurveyName: campaign.campaignName,
        writeSurveyName: campaign.campaignName,
        surveyQuestions: questions,
        templates: args.questionTemplates,
        questionMappings,
        answerMappings,
        pdiQuestions: args.pdiQuestions,
      });
      Object.assign(questionMappings, applied.questionMappings);
      Object.assign(answerMappings, applied.answerMappings);
    }
  }

  included.sort();
  missingFromSurveys.sort();
  return {
    questionMappings,
    answerMappings,
    summary: {
      scope: args.scope,
      included,
      missingFromSurveys,
      skippedUntagged,
    },
  };
}
