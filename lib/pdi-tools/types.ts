// ─── PDI API shapes (from pdi_questions.ndjson) ─────────────────────────────

export interface PdiAnswerOption {
  id: string;
  flagId: string;
  flagIdDescription: string;
  displayDescription: string;
  displayCode: string;
}

export interface PdiQuestion {
  id: string;
  organizationName: string;
  question: string;
  questionLabel: string;
  questionDescription: string;
  type: string;
  category: string;
  candidate: string;
  default: boolean;
  answerOptions: PdiAnswerOption[];
}

// ─── STW survey shapes (from stw_surveys.ndjson) ─────────────────────────────

export interface StwRow {
  name: string;
  question_name: string;
  answer_value: string;
}

/** Grouped: surveyName → questionName → answer_values[] */
export type StwData = Record<string, Record<string, string[]>>;

// ─── In-progress mapping state ────────────────────────────────────────────────

export interface QuestionMappingEntry {
  pdiQuestionId: string;
  mode: "question" | "standalone";
  confidence: "manual" | "auto";
  method: "user-selected" | "desc-match";
}

export interface AnswerMappingEntry {
  pdiQuestionId: string;
  pdiAnswerOptionId: string;
  pdiFlagId: string;
  pdiFlagCode: string;
  pdiFlagDesc: string;
  confidence: "manual" | "auto";
  method: "user-selected" | "desc-match";
}

export type QuestionMappings = Record<string, QuestionMappingEntry>;
export type AnswerMappings = Record<string, AnswerMappingEntry>;

// ─── Export schema (stw_pdi_mapping_*.json) ───────────────────────────────────

export type FlagScope =
  | "generic"
  | "question-specific"
  | "operational"
  | "demographic";

export interface FlagRegistryEntry {
  flagId: string;
  code: string;
  desc: string;
  scope: FlagScope;
  usedInNQuestions: number;
}

export interface OutputQuestionMapping {
  key: string;
  surveyName: string;
  stwQuestionName: string;
  pdiQuestionId: string;
  mode: "question" | "standalone";
  confidence: "manual" | "auto";
  method: "user-selected" | "desc-match";
}

export interface OutputAnswerMapping {
  key: string;
  surveyName: string;
  stwQuestionName: string;
  stwAnswerValue: string;
  pdiQuestionId: string;
  pdiAnswerOptionId: string;
  pdiFlagId: string;
  pdiFlagCode: string;
  pdiFlagDesc: string;
  confidence: "manual" | "auto";
  method: "user-selected" | "desc-match";
}

export interface MappingOutput {
  schemaVersion: 2;
  generated: string;
  description: string;
  stats: {
    totalQuestionMappings: number;
    totalAnswerMappings: number;
    surveys: number;
  };
  flagRegistry: FlagRegistryEntry[];
  questionMappings: OutputQuestionMapping[];
  answerMappings: OutputAnswerMapping[];
}
