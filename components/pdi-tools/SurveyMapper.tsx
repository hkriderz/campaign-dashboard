"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/pdi-tools/mapping-context";
import QuestionRow from "./QuestionRow";

export default function SurveyMapper() {
  const { state, dispatch } = useApp();
  const [confirmClear, setConfirmClear] = useState(false);
  const { activeSurvey, stwData, pdiQuestions, questionMappings } = state;

  if (!activeSurvey) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-gray-50 dark:bg-zinc-950 transition-colors">
        <div className="text-4xl mb-4 opacity-20">🗺</div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-zinc-400 mb-2">
          Select a survey from the sidebar
        </h2>
        <p className="text-[11px] text-gray-400 dark:text-zinc-600 max-w-xs leading-relaxed">
          Each STW survey shows its questions. Map each STW question to a PDI question, then answer-level
          flags auto-populate.
        </p>
      </div>
    );
  }

  const questions = stwData[activeSurvey] ?? {};
  const questionNames = Object.keys(questions).sort();
  const totalMapped = questionNames.filter((q) => questionMappings[`${activeSurvey}||${q}`]).length;
  const pct = questionNames.length > 0 ? Math.round((totalMapped / questionNames.length) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-zinc-950 transition-colors">
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700/50 px-4 py-2 flex items-center gap-3 transition-colors">
        <div className="flex-1 min-w-0">
          <h2 className="text-[12px] font-bold text-gray-800 dark:text-zinc-100 truncate" title={activeSurvey}>
            {activeSurvey}
          </h2>
          <p className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">
            {questionNames.length} question{questionNames.length !== 1 ? "s" : ""} · {totalMapped} mapped
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-24 h-1 rounded-full bg-gray-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pct === 100 ? "bg-green-500" : "bg-green-600 dark:bg-green-700"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-mono">{pct}%</span>
        </div>

        {totalMapped > 0 ? (
          confirmClear ? (
            <div className="flex items-center gap-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded px-2 py-0.5">
              <span className="text-[11px] text-red-600 dark:text-red-400">Clear survey?</span>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "CLEAR_SURVEY", surveyName: activeSurvey });
                  setConfirmClear(false);
                }}
                className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors"
              >
                Yes
              </button>
              <span className="text-gray-300 dark:text-zinc-600 text-[11px]">·</span>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="text-[11px] text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="text-[11px] px-2 py-0.5 rounded border border-gray-200 dark:border-zinc-700 text-gray-400 dark:text-zinc-500 hover:border-red-300 dark:hover:border-red-600/50 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              ✕ Clear survey
            </button>
          )
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {questionNames.length === 0 ? (
          <p className="text-[11px] text-gray-400 dark:text-zinc-600 text-center mt-8">
            No questions found for this survey.
          </p>
        ) : (
          questionNames.map((questionName) => (
            <QuestionRow
              key={questionName}
              surveyName={activeSurvey}
              questionName={questionName}
              answers={questions[questionName]}
              pdiQuestions={pdiQuestions}
            />
          ))
        )}
      </div>
    </div>
  );
}
