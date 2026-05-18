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

const STORAGE_KEY = "campaign_dashboard_pdi_mapper_v1";

export interface AppState {
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
}

const initialState: AppState = {
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
  | { type: "CLEAR_ALL" };

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
        dataLoaded: true,
        loadError: null,
        isRefreshing: false,
      };
    }

    case "SET_ACTIVE_SURVEY": {
      const survey = action.survey;
      const canvassKey = `${survey}||Canvass Result`;

      if (state.questionMappings[canvassKey]) {
        return { ...state, activeSurvey: survey };
      }

      const answers = state.stwData[survey]?.["Canvass Result"];
      if (!answers) {
        return { ...state, activeSurvey: survey };
      }

      const pdiQ = state.pdiQuestions.find((q) => q.question === "Non-Contact Online Phone Bank");
      if (!pdiQ) {
        return { ...state, activeSurvey: survey };
      }

      const matches = autoMatchAllAnswers(answers, pdiQ.answerOptions);
      const newAnswerMappings = { ...state.answerMappings };
      for (const [av, match] of Object.entries(matches)) {
        newAnswerMappings[`${canvassKey}||${av}`] = {
          pdiQuestionId: pdiQ.id,
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
        activeSurvey: survey,
        questionMappings: {
          ...state.questionMappings,
          [canvassKey]: {
            pdiQuestionId: pdiQ.id,
            mode: "question",
            confidence: "auto",
            method: "desc-match",
          },
        },
        answerMappings: newAnswerMappings,
      };
    }

    case "MAP_QUESTION": {
      const { surveyName, questionName, pdiQuestionId, pdiQuestion, answers } = action;
      const key = qKey(surveyName, questionName);

      const matches = autoMatchAllAnswers(answers, pdiQuestion.answerOptions);
      const newAnswerMappings = { ...state.answerMappings };

      for (const ans of answers) {
        const ak = aKey(surveyName, questionName, ans);
        if (newAnswerMappings[ak] && newAnswerMappings[ak].confidence === "auto") {
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
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    if (!state.dataLoaded) return;
    try {
      const persisted = {
        questionMappings: state.questionMappings,
        answerMappings: state.answerMappings,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // ignore quota
    }
  }, [state.questionMappings, state.answerMappings, state.dataLoaded]);

  useEffect(() => {
    loadData("cached");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData(source: "cached" | "api") {
    dispatch({ type: "SET_REFRESHING", value: true });
    dispatch({ type: "SET_LOAD_ERROR", error: null });

    try {
      const suffix = source === "cached" ? "?source=cached" : "";
      const [pdiRes, stwRes] = await Promise.all([
        fetch(`/api/pdi/pdi-questions${suffix}`),
        fetch(`/api/pdi/stw-surveys${suffix}`),
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
            : `STW surveys failed: ${stwRes.statusText}`
        );
      }

      const [pdiData, stwData] = await Promise.all([pdiRes.json(), stwRes.json()]);

      dispatch({
        type: "LOAD_DATA",
        pdiQuestions: pdiData.questions,
        stwData: stwData.surveys,
      });

      if (source === "api") {
        dispatch({ type: "SET_REFRESHED_AT", ts: new Date().toISOString() });
      }

      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const { questionMappings, answerMappings } = JSON.parse(saved) as {
            questionMappings: QuestionMappings;
            answerMappings: AnswerMappings;
          };
          dispatch({ type: "LOAD_MAPPING", questionMappings, answerMappings });
        }
      } catch {
        // ignore
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      dispatch({ type: "SET_LOAD_ERROR", error: msg });
    }
  }

  const refreshFromApi = useCallback(() => loadData("api"), []);

  const mapQuestion = useCallback(
    (surveyName: string, questionName: string, pdiQuestionId: string) => {
      const pdiQuestion = state.pdiQuestions.find((q) => q.id === pdiQuestionId);
      if (!pdiQuestion) return;
      const answers = state.stwData[surveyName]?.[questionName] ?? [];
      dispatch({
        type: "MAP_QUESTION",
        surveyName,
        questionName,
        pdiQuestionId,
        pdiQuestion,
        answers,
      });
    },
    [state.pdiQuestions, state.stwData]
  );

  const unmapQuestion = useCallback(
    (surveyName: string, questionName: string) => {
      const answers = state.stwData[surveyName]?.[questionName] ?? [];
      dispatch({ type: "UNMAP_QUESTION", surveyName, questionName, answers });
    },
    [state.stwData]
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
        surveyName,
        questionName,
        answerValue,
        pdiQuestionId,
        option,
        confidence: "manual",
      });
    },
    []
  );

  const unmapAnswer = useCallback(
    (surveyName: string, questionName: string, answerValue: string) => {
      dispatch({ type: "UNMAP_ANSWER", surveyName, questionName, answerValue });
    },
    []
  );

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
