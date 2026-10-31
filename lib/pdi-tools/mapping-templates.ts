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
  /** Candidate tag this lesson belongs to. Absent lessons still match by campaign name. */
  candidateTagId?: string;
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
    const candidateTagId = typeof rec.candidateTagId === "string" ? rec.candidateTagId.trim() : "";
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
    out[questionName] = {
      sourceSurveyName,
      pdiQuestionId,
      ...(candidateTagId ? { candidateTagId } : {}),
      answers,
    };
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
  candidateTagId?: string | null;
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
  const candidateTagId = args.candidateTagId?.trim() || "";
  return {
    sourceSurveyName: args.displaySurveyName,
    pdiQuestionId: qMapping.pdiQuestionId,
    ...(candidateTagId ? { candidateTagId } : {}),
    answers,
  };
}

/**
 * A saved lesson applies to a campaign from the same candidate.
 * Lessons saved before candidate tags existed still match by campaign name.
 * A different PDI question on one list does not replace the lesson.
 */
export function templateAppliesToCampaign(
  template: QuestionTemplate,
  displaySurveyName: string,
  targetCandidateTagId?: string | null
): boolean {
  const templateTag = template.candidateTagId?.trim() || "";
  const targetTag = targetCandidateTagId?.trim() || "";
  if (templateTag || targetTag) {
    return Boolean(templateTag && targetTag && templateTag === targetTag);
  }
  return campaignNamesSimilar(template.sourceSurveyName, displaySurveyName);
}

/**
 * Learn a mapping without replacing a different saved question.
 * New answers fill gaps. Save mappings passes force and replaces the lesson.
 */
export function learnQuestionTemplate(
  existing: QuestionTemplate | undefined,
  incoming: QuestionTemplate,
  force: boolean
): QuestionTemplate {
  if (!existing || force) {
    return { ...incoming, answers: { ...incoming.answers } };
  }
  if (existing.pdiQuestionId !== incoming.pdiQuestionId) return existing;
  const answers = { ...existing.answers };
  for (const [answerValue, saved] of Object.entries(incoming.answers)) {
    if (!answers[answerValue]) answers[answerValue] = saved;
  }
  return {
    ...existing,
    candidateTagId: existing.candidateTagId ?? incoming.candidateTagId,
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

/** Copy one question onto another survey name. A different saved question is left in place unless force is set. */
export function copyMappedQuestion(args: {
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
  fromSurvey: string;
  toSurvey: string;
  questionName: string;
  force?: boolean;
}): { questionMappings: QuestionMappings; answerMappings: AnswerMappings } {
  const fromKey = qKey(args.fromSurvey, args.questionName);
  const source = args.questionMappings[fromKey];
  if (!source) {
    return { questionMappings: args.questionMappings, answerMappings: args.answerMappings };
  }
  const toKey = qKey(args.toSurvey, args.questionName);
  const destination = args.questionMappings[toKey];
  if (destination && destination.pdiQuestionId !== source.pdiQuestionId && !args.force) {
    return { questionMappings: args.questionMappings, answerMappings: args.answerMappings };
  }

  const questionMappings = { ...args.questionMappings, [toKey]: source };
  const answerMappings = { ...args.answerMappings };
  const fromPrefix = `${fromKey}||`;
  const toPrefix = `${toKey}||`;
  if (args.force || !destination) {
    for (const key of Object.keys(answerMappings)) {
      if (key.startsWith(toPrefix)) delete answerMappings[key];
    }
  }
  for (const [key, entry] of Object.entries(args.answerMappings)) {
    if (!key.startsWith(fromPrefix)) continue;
    const answerValue = key.slice(fromPrefix.length);
    const destKey = `${toPrefix}${answerValue}`;
    if (!args.force && answerMappings[destKey]) continue;
    answerMappings[destKey] = entry;
  }
  return { questionMappings, answerMappings };
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
  targetCandidateTagId?: string | null;
}): { questionMappings: QuestionMappings; answerMappings: AnswerMappings } {
  const questionMappings = { ...args.questionMappings };
  const answerMappings = { ...args.answerMappings };

  for (const [questionName, answers] of Object.entries(args.surveyQuestions)) {
    const questionKey = qKey(args.writeSurveyName, questionName);
    if (questionMappings[questionKey]) continue;
    const template = args.templates[questionName];
    if (!template) continue;
    if (!templateAppliesToCampaign(template, args.displaySurveyName, args.targetCandidateTagId)) continue;
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
