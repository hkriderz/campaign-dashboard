import { autoMatchAllAnswers, normalizeMatchText } from "./auto-match";
import type { PdiSyncChannel } from "./channel";
import type {
  AnswerMappingEntry,
  AnswerMappings,
  PdiQuestion,
  QuestionMappings,
} from "./types";

export interface SavedAnswerTemplate {
  pdiQuestionId: string;
  pdiAnswerOptionId: string;
  pdiFlagId: string;
  pdiFlagCode: string;
  pdiFlagDesc: string;
}

export interface QuestionTemplate {
  sourceSurveyName: string;
  pdiQuestionId: string;
  answers: Record<string, SavedAnswerTemplate>;
}

export type QuestionTemplates = Record<string, QuestionTemplate>;

const CAMPAIGN_NAME_FILLER = new Set([
  "stw",
  "text",
  "phone",
  "bank",
  "pb",
  "campaign",
  "list",
  "survey",
  "the",
  "a",
  "an",
  "of",
  "for",
  "and",
  "to",
]);

export function templateStorageKey(channel: PdiSyncChannel): string {
  return channel === "text"
    ? "campaign_dashboard_pdi_mapper_templates_text_v1"
    : "campaign_dashboard_pdi_mapper_templates_dialer_v1";
}

export function campaignNameTokens(name: string): string[] {
  return normalizeMatchText(name)
    .split(/\s+/)
    .filter((token) => token.length > 0 && !CAMPAIGN_NAME_FILLER.has(token));
}

export function campaignNamesSimilar(a: string, b: string): boolean {
  const tokensA = campaignNameTokens(a);
  const tokensB = campaignNameTokens(b);
  const joinedA = tokensA.join(" ");
  const joinedB = tokensB.join(" ");
  if (!joinedA || !joinedB) return false;
  if (joinedA === joinedB) return true;
  if (joinedA.includes(joinedB) || joinedB.includes(joinedA)) return true;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared += 1;
  }
  const overlap = shared / Math.max(setA.size, setB.size);
  if (overlap >= 0.4) return true;
  for (const token of setA) {
    if (token.length >= 4 && setB.has(token)) return true;
  }
  return false;
}

export function parseQuestionTemplates(raw: unknown): QuestionTemplates {
  if (!raw || typeof raw !== "object") return {};
  const out: QuestionTemplates = {};
  for (const [questionName, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!questionName.trim() || !value || typeof value !== "object") continue;
    const rec = value as Record<string, unknown>;
    const sourceSurveyName = typeof rec.sourceSurveyName === "string" ? rec.sourceSurveyName.trim() : "";
    const pdiQuestionId = typeof rec.pdiQuestionId === "string" ? rec.pdiQuestionId.trim() : "";
    if (!sourceSurveyName || !pdiQuestionId) continue;
    const answers: Record<string, SavedAnswerTemplate> = {};
    if (rec.answers && typeof rec.answers === "object") {
      for (const [answerValue, saved] of Object.entries(rec.answers as Record<string, unknown>)) {
        if (!saved || typeof saved !== "object") continue;
        const a = saved as Record<string, unknown>;
        const savedPdiQuestionId = typeof a.pdiQuestionId === "string" ? a.pdiQuestionId : "";
        const pdiAnswerOptionId = typeof a.pdiAnswerOptionId === "string" ? a.pdiAnswerOptionId : "";
        const pdiFlagId = typeof a.pdiFlagId === "string" ? a.pdiFlagId : "";
        const pdiFlagCode = typeof a.pdiFlagCode === "string" ? a.pdiFlagCode : "";
        const pdiFlagDesc = typeof a.pdiFlagDesc === "string" ? a.pdiFlagDesc : "";
        if (!savedPdiQuestionId || !pdiAnswerOptionId || !pdiFlagId) continue;
        answers[answerValue] = {
          pdiQuestionId: savedPdiQuestionId,
          pdiAnswerOptionId,
          pdiFlagId,
          pdiFlagCode,
          pdiFlagDesc,
        };
      }
    }
    out[questionName] = { sourceSurveyName, pdiQuestionId, answers };
  }
  return out;
}

export function buildQuestionTemplate(args: {
  displaySurveyName: string;
  writeSurveyName: string;
  questionName: string;
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
  answers: string[];
}): QuestionTemplate | null {
  const qMapping = args.questionMappings[`${args.writeSurveyName}||${args.questionName}`];
  if (!qMapping) return null;
  const answers: Record<string, SavedAnswerTemplate> = {};
  for (const answerValue of args.answers) {
    const mapped = args.answerMappings[`${args.writeSurveyName}||${args.questionName}||${answerValue}`];
    if (!mapped) continue;
    answers[answerValue] = {
      pdiQuestionId: mapped.pdiQuestionId,
      pdiAnswerOptionId: mapped.pdiAnswerOptionId,
      pdiFlagId: mapped.pdiFlagId,
      pdiFlagCode: mapped.pdiFlagCode,
      pdiFlagDesc: mapped.pdiFlagDesc,
    };
  }
  return {
    sourceSurveyName: args.displaySurveyName,
    pdiQuestionId: qMapping.pdiQuestionId,
    answers,
  };
}

export function deleteQuestionTemplate(
  templates: QuestionTemplates,
  questionName: string
): QuestionTemplates {
  if (!(questionName in templates)) return templates;
  const next = { ...templates };
  delete next[questionName];
  return next;
}

function qKey(survey: string, question: string): string {
  return `${survey}||${question}`;
}

function aKey(survey: string, question: string, answer: string): string {
  return `${survey}||${question}||${answer}`;
}

function templateAnswerToMapping(
  saved: SavedAnswerTemplate,
  confidence: AnswerMappingEntry["confidence"],
  method: AnswerMappingEntry["method"]
): AnswerMappingEntry {
  return {
    pdiQuestionId: saved.pdiQuestionId,
    pdiAnswerOptionId: saved.pdiAnswerOptionId,
    pdiFlagId: saved.pdiFlagId,
    pdiFlagCode: saved.pdiFlagCode,
    pdiFlagDesc: saved.pdiFlagDesc,
    confidence,
    method,
  };
}

export function applyTemplatesToSurvey(args: {
  displaySurveyName: string;
  writeSurveyName: string;
  surveyQuestions: Record<string, string[]>;
  templates: QuestionTemplates;
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
  pdiQuestions: PdiQuestion[];
}): { questionMappings: QuestionMappings; answerMappings: AnswerMappings } {
  const questionMappings = { ...args.questionMappings };
  const answerMappings = { ...args.answerMappings };

  for (const [questionName, answers] of Object.entries(args.surveyQuestions)) {
    const questionKey = qKey(args.writeSurveyName, questionName);
    if (questionMappings[questionKey]) continue;
    const template = args.templates[questionName];
    if (!template) continue;
    if (!campaignNamesSimilar(template.sourceSurveyName, args.displaySurveyName)) continue;
    const pdiQuestion = args.pdiQuestions.find((q) => q.id === template.pdiQuestionId);
    if (!pdiQuestion) continue;

    questionMappings[questionKey] = {
      pdiQuestionId: template.pdiQuestionId,
      mode: "question",
      confidence: "auto",
      method: "user-selected",
    };

    for (const answerValue of answers) {
      const saved = template.answers[answerValue];
      if (!saved) continue;
      answerMappings[aKey(args.writeSurveyName, questionName, answerValue)] = templateAnswerToMapping(
        saved,
        "auto",
        "user-selected"
      );
    }

    const unmatched = answers.filter(
      (answerValue) => !answerMappings[aKey(args.writeSurveyName, questionName, answerValue)]
    );
    const matches = autoMatchAllAnswers(unmatched, pdiQuestion.answerOptions);
    for (const [answerValue, match] of Object.entries(matches)) {
      answerMappings[aKey(args.writeSurveyName, questionName, answerValue)] = {
        pdiQuestionId: pdiQuestion.id,
        pdiAnswerOptionId: match.option.id,
        pdiFlagId: match.option.flagId,
        pdiFlagCode: match.option.displayCode,
        pdiFlagDesc: match.option.displayDescription,
        confidence: match.confidence,
        method: match.method,
      };
    }
  }

  return { questionMappings, answerMappings };
}
