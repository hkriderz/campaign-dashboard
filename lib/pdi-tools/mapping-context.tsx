"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
} from "react";
import type {
  PdiQuestion,
  StwData,
  QuestionMappings,
  AnswerMappings,
  PdiAnswerOption,
} from "./types";
import { autoMatchAllAnswers } from "./auto-match";
import { hasMappableTextQuestions } from "./text-tag-stw-data";
import {
  mappingIdentitySurveyName,
  mapperStorageKey,
  parsePdiSyncChannel,
  parseTextMappingScope,
  type PdiSyncChannel,
  type TextMappingScope,
} from "./channel";
import { collectAnswersAcrossSurveys } from "./text-tag-stw-data";
import {
  applyTemplatesToSurvey,
  buildQuestionTemplate,
  deleteQuestionTemplate,
  parseQuestionTemplates,
  templateStorageKey,
  type QuestionTemplates,
} from "./mapping-templates";

const CHANNEL_STORAGE_KEY = "campaign_dashboard_pdi_mapper_channel";
const TEXT_SCOPE_STORAGE_KEY = "campaign_dashboard_pdi_mapper_text_scope_v1";

function persistMappings(channel: PdiSyncChannel, questionMappings: QuestionMappings, answerMappings: AnswerMappings) {
  try {
    localStorage.setItem(
      mapperStorageKey(channel),
      JSON.stringify({ questionMappings, answerMappings })
    );
  } catch {
    // ignore quota
  }
}

function readPersistedMappings(channel: PdiSyncChannel): {
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
} | null {
  try {
    const saved = localStorage.getItem(mapperStorageKey(channel));
    if (!saved) return null;
    return JSON.parse(saved) as {
      questionMappings: QuestionMappings;
      answerMappings: AnswerMappings;
    };
  } catch {
    return null;
  }
}

function persistTemplates(channel: PdiSyncChannel, templates: QuestionTemplates) {
  try {
    localStorage.setItem(templateStorageKey(channel), JSON.stringify(templates));
  } catch {
    // ignore quota
  }
}

function readPersistedTemplates(channel: PdiSyncChannel): QuestionTemplates {
  try {
    const saved = localStorage.getItem(templateStorageKey(channel));
    if (!saved) return {};
    return parseQuestionTemplates(JSON.parse(saved));
  } catch {
    return {};
  }
}

export interface AppState {
  channel: PdiSyncChannel;
  textMappingScope: TextMappingScope;
  pdiQuestions: PdiQuestion[];
  stwData: StwData;
  activeSurvey: string | null;
  questionMappings: QuestionMappings;
  answerMappings: AnswerMappings;
  rightTab: "inspector" | "export";
  dataLoaded: boolean;
  isRefreshing: boolean;
  loadError: string | null;
  lastRefreshedAt: string | null;
  questionTemplates: QuestionTemplates;
}

const initialState: AppState = {
  channel: "dialer",
  textMappingScope: "all",
  pdiQuestions: [],
  stwData: {},
  activeSurvey: null,
  questionMappings: {},
  answerMappings: {},
  rightTab: "inspector",
  dataLoaded: false,
  isRefreshing: false,
  loadError: null,
  lastRefreshedAt: null,
  questionTemplates: {},
};

type Action =
  | { type: "LOAD_DATA"; pdiQuestions: PdiQuestion[]; stwData: StwData }
  | { type: "SET_ACTIVE_SURVEY"; survey: string }
  | {
      type: "MAP_QUESTION";
      surveyName: string;
      questionName: string;
      pdiQuestionId: string;
      pdiQuestion: PdiQuestion;
      answers: string[];
    }
  | {
      type: "UNMAP_QUESTION";
      surveyName: string;
      questionName: string;
      answers: string[];
    }
  | {
      type: "MAP_ANSWER";
      surveyName: string;
      questionName: string;
      answerValue: string;
      pdiQuestionId: string;
      option: PdiAnswerOption;
      confidence: "manual" | "auto";
    }
  | {
      type: "UNMAP_ANSWER";
      surveyName: string;
      questionName: string;
      answerValue: string;
    }
  | {
      type: "LOAD_MAPPING";
      questionMappings: QuestionMappings;
      answerMappings: AnswerMappings;
    }
  | { type: "SET_RIGHT_TAB"; tab: "inspector" | "export" }
  | { type: "SET_REFRESHING"; value: boolean }
  | { type: "SET_LOAD_ERROR"; error: string | null }
  | { type: "SET_REFRESHED_AT"; ts: string }
  | { type: "CLEAR_SURVEY"; surveyName: string }
  | { type: "CLEAR_ALL" }
  | { type: "SET_CHANNEL"; channel: PdiSyncChannel }
  | { type: "SET_TEXT_MAPPING_SCOPE"; scope: TextMappingScope }
  | { type: "LOAD_TEMPLATES"; templates: QuestionTemplates }
  | { type: "SAVE_QUESTION_TEMPLATE"; questionName: string; template: QuestionTemplates[string] }
  | { type: "DELETE_QUESTION_TEMPLATE"; questionName: string };

function qKey(survey: string, question: string): string {
  return `${survey}||${question}`;
}

function aKey(survey: string, question: string, answer: string): string {
  return `${survey}||${question}||${answer}`;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "LOAD_DATA": {
      return {
        ...state,
        pdiQuestions: action.pdiQuestions,
        stwData: action.stwData,
        activeSurvey: null,
        dataLoaded: true,
        loadError: null,
        isRefreshing: false,
      };
    }

    case "SET_ACTIVE_SURVEY": {
      const survey = action.survey;
      if (state.channel === "text" && !hasMappableTextQuestions(state.stwData[survey])) {
        return state;
      }

      let questionMappings = state.questionMappings;
      let answerMappings = state.answerMappings;
      const canvassKey = `${survey}||Canvass Result`;
      const canvassAnswers = state.stwData[survey]?.["Canvass Result"];
      const canvassPdi = canvassAnswers
        ? state.pdiQuestions.find((q) => q.question === "Non-Contact Online Phone Bank")
        : undefined;

      if (canvassAnswers && canvassPdi && !questionMappings[canvassKey]) {
        const matches = autoMatchAllAnswers(canvassAnswers, canvassPdi.answerOptions);
        const newAnswerMappings = { ...answerMappings };
        for (const [av, match] of Object.entries(matches)) {
          newAnswerMappings[`${canvassKey}||${av}`] = {
            pdiQuestionId: canvassPdi.id,
            pdiAnswerOptionId: match.option.id,
            pdiFlagId: match.option.flagId,
            pdiFlagCode: match.option.displayCode,
            pdiFlagDesc: match.option.displayDescription,
            confidence: match.confidence,
            method: match.method,
          };
        }
        questionMappings = {
          ...questionMappings,
          [canvassKey]: {
            pdiQuestionId: canvassPdi.id,
            mode: "question",
            confidence: "auto",
            method: "desc-match",
          },
        };
        answerMappings = newAnswerMappings;
      }

      const writeSurveyName = mappingIdentitySurveyName(
        state.channel,
        survey,
        state.textMappingScope
      );
      const applied = applyTemplatesToSurvey({
        displaySurveyName: survey,
        writeSurveyName,
        surveyQuestions: state.stwData[survey] ?? {},
        templates: state.questionTemplates,
        questionMappings,
        answerMappings,
        pdiQuestions: state.pdiQuestions,
      });

      return {
        ...state,
        activeSurvey: survey,
        questionMappings: applied.questionMappings,
        answerMappings: applied.answerMappings,
      };
    }

    case "MAP_QUESTION": {
      const { surveyName, questionName, pdiQuestionId, pdiQuestion, answers } = action;
      const key = qKey(surveyName, questionName);

      const matches = autoMatchAllAnswers(answers, pdiQuestion.answerOptions);
      const newAnswerMappings = { ...state.answerMappings };

      for (const ans of answers) {
        const ak = aKey(surveyName, questionName, ans);
        const existing = newAnswerMappings[ak];
        if (existing && existing.pdiQuestionId !== pdiQuestionId) {
          delete newAnswerMappings[ak];
          continue;
        }
        if (existing && existing.confidence === "auto") {
          delete newAnswerMappings[ak];
        }
      }

      for (const [answerValue, match] of Object.entries(matches)) {
        const ak = aKey(surveyName, questionName, answerValue);
        if (newAnswerMappings[ak] && newAnswerMappings[ak].confidence === "manual") {
          continue;
        }
        newAnswerMappings[ak] = {
          pdiQuestionId,
          pdiAnswerOptionId: match.option.id,
          pdiFlagId: match.option.flagId,
          pdiFlagCode: match.option.displayCode,
          pdiFlagDesc: match.option.displayDescription,
          confidence: match.confidence,
          method: match.method,
        };
      }

      return {
        ...state,
        questionMappings: {
          ...state.questionMappings,
          [key]: {
            pdiQuestionId,
            mode: "question",
            confidence: "manual",
            method: "user-selected",
          },
        },
        answerMappings: newAnswerMappings,
      };
    }

    case "UNMAP_QUESTION": {
      const { surveyName, questionName, answers } = action;
      const key = qKey(surveyName, questionName);
      const newQuestionMappings = { ...state.questionMappings };
      delete newQuestionMappings[key];

      const newAnswerMappings = { ...state.answerMappings };
      for (const ans of answers) {
        delete newAnswerMappings[aKey(surveyName, questionName, ans)];
      }

      return {
        ...state,
        questionMappings: newQuestionMappings,
        answerMappings: newAnswerMappings,
      };
    }

    case "MAP_ANSWER": {
      const { surveyName, questionName, answerValue, pdiQuestionId, option, confidence } = action;
      const key = aKey(surveyName, questionName, answerValue);
      return {
        ...state,
        answerMappings: {
          ...state.answerMappings,
          [key]: {
            pdiQuestionId,
            pdiAnswerOptionId: option.id,
            pdiFlagId: option.flagId,
            pdiFlagCode: option.displayCode,
            pdiFlagDesc: option.displayDescription,
            confidence,
            method: confidence === "manual" ? "user-selected" : "desc-match",
          },
        },
      };
    }

    case "UNMAP_ANSWER": {
      const key = aKey(action.surveyName, action.questionName, action.answerValue);
      const newAnswerMappings = { ...state.answerMappings };
      delete newAnswerMappings[key];
      return { ...state, answerMappings: newAnswerMappings };
    }

    case "LOAD_MAPPING": {
      return {
        ...state,
        questionMappings: action.questionMappings,
        answerMappings: action.answerMappings,
      };
    }

    case "SET_RIGHT_TAB":
      return { ...state, rightTab: action.tab };

    case "SET_REFRESHING":
      return { ...state, isRefreshing: action.value };

    case "SET_LOAD_ERROR":
      return { ...state, loadError: action.error, isRefreshing: false };

    case "SET_REFRESHED_AT":
      return { ...state, lastRefreshedAt: action.ts };

    case "CLEAR_SURVEY": {
      const prefix = `${action.surveyName}||`;
      const newQM = Object.fromEntries(
        Object.entries(state.questionMappings).filter(([k]) => !k.startsWith(prefix))
      );
      const newAM = Object.fromEntries(
        Object.entries(state.answerMappings).filter(([k]) => !k.startsWith(prefix))
      );
      return { ...state, questionMappings: newQM, answerMappings: newAM };
    }

    case "CLEAR_ALL":
      return { ...state, questionMappings: {}, answerMappings: {} };

    case "SET_CHANNEL":
      if (action.channel === state.channel) return state;
      return {
        ...state,
        channel: action.channel,
        stwData: {},
        activeSurvey: null,
        questionMappings: {},
        answerMappings: {},
        dataLoaded: false,
        loadError: null,
        lastRefreshedAt: null,
        questionTemplates: {},
      };

    case "SET_TEXT_MAPPING_SCOPE":
      if (action.scope === state.textMappingScope) return state;
      return { ...state, textMappingScope: action.scope };

    case "LOAD_TEMPLATES":
      return { ...state, questionTemplates: action.templates };

    case "SAVE_QUESTION_TEMPLATE":
      return {
        ...state,
        questionTemplates: {
          ...state.questionTemplates,
          [action.questionName]: action.template,
        },
      };

    case "DELETE_QUESTION_TEMPLATE":
      return {
        ...state,
        questionTemplates: deleteQuestionTemplate(state.questionTemplates, action.questionName),
      };

    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  mapQuestion: (surveyName: string, questionName: string, pdiQuestionId: string) => void;
  unmapQuestion: (surveyName: string, questionName: string) => void;
  mapAnswer: (
    surveyName: string,
    questionName: string,
    answerValue: string,
    option: PdiAnswerOption,
    pdiQuestionId: string
  ) => void;
  unmapAnswer: (surveyName: string, questionName: string, answerValue: string) => void;
  refreshFromApi: () => Promise<void>;
  setChannel: (channel: PdiSyncChannel) => void;
  setTextMappingScope: (scope: TextMappingScope) => void;
  mappingSurveyName: (displaySurveyName: string) => string;
  saveQuestionTemplate: (displaySurveyName: string, questionName: string) => void;
  deleteSavedQuestionTemplate: (questionName: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    if (!state.dataLoaded) return;
    persistMappings(state.channel, state.questionMappings, state.answerMappings);
  }, [state.questionMappings, state.answerMappings, state.dataLoaded, state.channel]);

  useEffect(() => {
    if (!state.dataLoaded) return;
    persistTemplates(state.channel, state.questionTemplates);
  }, [state.questionTemplates, state.dataLoaded, state.channel]);

  useEffect(() => {
    let initial: PdiSyncChannel = "dialer";
    try {
      initial = parsePdiSyncChannel(localStorage.getItem(CHANNEL_STORAGE_KEY));
    } catch {
      initial = "dialer";
    }
    if (initial !== "dialer") {
      dispatch({ type: "SET_CHANNEL", channel: initial });
    }
    try {
      dispatch({
        type: "SET_TEXT_MAPPING_SCOPE",
        scope: parseTextMappingScope(localStorage.getItem(TEXT_SCOPE_STORAGE_KEY)),
      });
    } catch {
      // ignore
    }
    void loadData(initial === "text" ? "api" : "cached", initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData(source: "cached" | "api", channel: PdiSyncChannel) {
    dispatch({ type: "SET_REFRESHING", value: true });
    dispatch({ type: "SET_LOAD_ERROR", error: null });

    try {
      const pdiSuffix = source === "cached" ? "?source=cached" : "";
      const stwUrl =
        channel === "text" ? "/api/pdi/stw-text-tags" : `/api/pdi/stw-surveys${pdiSuffix}`;
      const [pdiRes, stwRes] = await Promise.all([
        fetch(`/api/pdi/pdi-questions${pdiSuffix}`),
        fetch(stwUrl),
      ]);

      if (!pdiRes.ok) {
        const errBody = await pdiRes.json().catch(() => ({}));
        throw new Error(
          typeof errBody === "object" && errBody && "error" in errBody
            ? String((errBody as { error: string }).error)
            : `PDI questions failed: ${pdiRes.statusText}`
        );
      }
      if (!stwRes.ok) {
        const errBody = await stwRes.json().catch(() => ({}));
        throw new Error(
          typeof errBody === "object" && errBody && "error" in errBody
            ? String((errBody as { error: string }).error)
            : channel === "text"
              ? `STW text tags failed: ${stwRes.statusText}`
              : `STW surveys failed: ${stwRes.statusText}`
        );
      }

      const [pdiData, stwData] = await Promise.all([pdiRes.json(), stwRes.json()]);

      dispatch({ type: "LOAD_TEMPLATES", templates: readPersistedTemplates(channel) });
      dispatch({
        type: "LOAD_DATA",
        pdiQuestions: pdiData.questions,
        stwData: stwData.surveys,
      });

      if (source === "api") {
        dispatch({ type: "SET_REFRESHED_AT", ts: new Date().toISOString() });
      }

      const saved = readPersistedMappings(channel);
      if (saved) {
        dispatch({ type: "LOAD_MAPPING", questionMappings: saved.questionMappings, answerMappings: saved.answerMappings });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      dispatch({ type: "SET_LOAD_ERROR", error: msg });
    }
  }

  const refreshFromApi = useCallback(() => loadData("api", state.channel), [state.channel]);

  const setChannel = useCallback(
    (next: PdiSyncChannel) => {
      if (next === state.channel) return;
      persistMappings(state.channel, state.questionMappings, state.answerMappings);
      persistTemplates(state.channel, state.questionTemplates);
      try {
        localStorage.setItem(CHANNEL_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      dispatch({ type: "SET_CHANNEL", channel: next });
      void loadData(next === "text" ? "api" : "cached", next);
    },
    [state.channel, state.questionMappings, state.answerMappings, state.questionTemplates]
  );

  const mappingSurveyName = useCallback(
    (displaySurveyName: string) =>
      mappingIdentitySurveyName(state.channel, displaySurveyName, state.textMappingScope),
    [state.channel, state.textMappingScope]
  );

  const answersForQuestion = useCallback(
    (displaySurveyName: string, questionName: string) => {
      if (state.channel === "text" && state.textMappingScope === "all") {
        return collectAnswersAcrossSurveys(state.stwData, questionName);
      }
      return state.stwData[displaySurveyName]?.[questionName] ?? [];
    },
    [state.channel, state.textMappingScope, state.stwData]
  );

  const mapQuestion = useCallback(
    (surveyName: string, questionName: string, pdiQuestionId: string) => {
      const pdiQuestion = state.pdiQuestions.find((q) => q.id === pdiQuestionId);
      if (!pdiQuestion) return;
      dispatch({
        type: "MAP_QUESTION",
        surveyName: mappingIdentitySurveyName(state.channel, surveyName, state.textMappingScope),
        questionName,
        pdiQuestionId,
        pdiQuestion,
        answers: answersForQuestion(surveyName, questionName),
      });
    },
    [state.pdiQuestions, state.channel, state.textMappingScope, answersForQuestion]
  );

  const unmapQuestion = useCallback(
    (surveyName: string, questionName: string) => {
      dispatch({
        type: "UNMAP_QUESTION",
        surveyName: mappingIdentitySurveyName(state.channel, surveyName, state.textMappingScope),
        questionName,
        answers: answersForQuestion(surveyName, questionName),
      });
    },
    [state.channel, state.textMappingScope, answersForQuestion]
  );

  const mapAnswer = useCallback(
    (
      surveyName: string,
      questionName: string,
      answerValue: string,
      option: PdiAnswerOption,
      pdiQuestionId: string
    ) => {
      dispatch({
        type: "MAP_ANSWER",
        surveyName: mappingIdentitySurveyName(state.channel, surveyName, state.textMappingScope),
        questionName,
        answerValue,
        pdiQuestionId,
        option,
        confidence: "manual",
      });
    },
    [state.channel, state.textMappingScope]
  );

  const unmapAnswer = useCallback(
    (surveyName: string, questionName: string, answerValue: string) => {
      dispatch({
        type: "UNMAP_ANSWER",
        surveyName: mappingIdentitySurveyName(state.channel, surveyName, state.textMappingScope),
        questionName,
        answerValue,
      });
    },
    [state.channel, state.textMappingScope]
  );

  const setTextMappingScope = useCallback((scope: TextMappingScope) => {
    try {
      localStorage.setItem(TEXT_SCOPE_STORAGE_KEY, scope);
    } catch {
      // ignore
    }
    dispatch({ type: "SET_TEXT_MAPPING_SCOPE", scope });
  }, []);

  const saveQuestionTemplate = useCallback(
    (displaySurveyName: string, questionName: string) => {
      const writeSurveyName = mappingIdentitySurveyName(
        state.channel,
        displaySurveyName,
        state.textMappingScope
      );
      const template = buildQuestionTemplate({
        displaySurveyName,
        writeSurveyName,
        questionName,
        questionMappings: state.questionMappings,
        answerMappings: state.answerMappings,
        answers: answersForQuestion(displaySurveyName, questionName),
      });
      if (!template) return;
      dispatch({ type: "SAVE_QUESTION_TEMPLATE", questionName, template });
    },
    [
      state.channel,
      state.textMappingScope,
      state.questionMappings,
      state.answerMappings,
      answersForQuestion,
    ]
  );

  const deleteSavedQuestionTemplate = useCallback((questionName: string) => {
    dispatch({ type: "DELETE_QUESTION_TEMPLATE", questionName });
  }, []);

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        mapQuestion,
        unmapQuestion,
        mapAnswer,
        unmapAnswer,
        refreshFromApi,
        setChannel,
        setTextMappingScope,
        mappingSurveyName,
        saveQuestionTemplate,
        deleteSavedQuestionTemplate,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
