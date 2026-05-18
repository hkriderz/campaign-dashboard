"use client";

import React from "react";
import { useApp } from "@/lib/pdi-tools/mapping-context";
import type { PdiQuestion, PdiAnswerOption, AnswerMappingEntry } from "@/lib/pdi-tools/types";
import PdiQuestionCombobox from "./PdiQuestionCombobox";

interface Props {
  surveyName: string;
  questionName: string;
  answers: string[];
  pdiQuestions: PdiQuestion[];
}

export default function QuestionRow({ surveyName, questionName, answers, pdiQuestions }: Props) {
  const { state, mapQuestion, unmapQuestion, mapAnswer, unmapAnswer } = useApp();

  const questionKey = `${surveyName}||${questionName}`;
  const qMapping = state.questionMappings[questionKey];
  const mappedPdiQuestion = qMapping ? pdiQuestions.find((q) => q.id === qMapping.pdiQuestionId) : null;

  const mappedAnswerCount = answers.filter((a) => state.answerMappings[`${questionKey}||${a}`]).length;

  function handleQuestionChange(id: string) {
    if (!id) {
      unmapQuestion(surveyName, questionName);
    } else {
      mapQuestion(surveyName, questionName, id);
    }
  }

  function handleAnswerSelect(answerValue: string, optionId: string, pdiQuestionId: string) {
    if (!optionId) {
      unmapAnswer(surveyName, questionName, answerValue);
      return;
    }
    const opt = mappedPdiQuestion?.answerOptions.find((o) => o.id === optionId);
    if (!opt) return;
    mapAnswer(surveyName, questionName, answerValue, opt, pdiQuestionId);
  }

  const isFullyMapped = Boolean(qMapping && mappedAnswerCount === answers.length);

  return (
    <div
      className={`mb-3 rounded border transition-colors overflow-visible ${
        isFullyMapped
          ? "border-green-300 dark:border-green-700/40 bg-green-50/50 dark:bg-green-950/10"
          : qMapping
            ? "border-gray-200 dark:border-zinc-600/50 bg-white dark:bg-zinc-900/40"
            : "border-gray-200 dark:border-zinc-700/40 bg-white dark:bg-zinc-900/20"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-zinc-700/40">
        <span className="text-[11px] font-semibold text-gray-800 dark:text-zinc-100 flex-1 truncate" title={questionName}>
          {questionName}
        </span>

        {mappedPdiQuestion?.type ? <TypeBadge type={mappedPdiQuestion.type} /> : null}

        {qMapping ? <ConfidenceBadge confidence={qMapping.confidence} /> : null}

        <span className="text-[10px] text-gray-400 dark:text-zinc-600 whitespace-nowrap">{answers.length} ans</span>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-zinc-700/40">
        <span className="text-[10px] text-gray-400 dark:text-zinc-500 whitespace-nowrap font-mono flex-shrink-0">
          MAP TO PDI →
        </span>
        <div className="flex-1 min-w-0">
          <PdiQuestionCombobox
            value={qMapping?.pdiQuestionId ?? ""}
            onChange={handleQuestionChange}
            questions={pdiQuestions}
          />
        </div>
      </div>

      {mappedPdiQuestion ? (
        <div className="px-3 py-1 border-b border-gray-100 dark:border-zinc-700/40 bg-green-50/60 dark:bg-zinc-900/30">
          <span className="text-[10px] text-green-700 dark:text-green-500">
            ✓ Showing {mappedPdiQuestion.answerOptions.length} answer options from PDI:{" "}
            <span className="font-medium text-green-700 dark:text-green-400">
              {mappedPdiQuestion.questionLabel || mappedPdiQuestion.question}
            </span>
            <span className="text-gray-400 dark:text-zinc-600 ml-1.5">
              · {mappedAnswerCount}/{answers.length} flags mapped
            </span>
          </span>
        </div>
      ) : null}

      {qMapping ? (
        <>
          <div className="flex items-center px-3 py-1 bg-gray-50 dark:bg-zinc-900/60 border-b border-gray-100 dark:border-zinc-800/60">
            <span className="text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-wide w-44 flex-shrink-0">
              STW Answer
            </span>
            <span className="text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-wide ml-28 flex-1">
              PDI Flag / Answer Option
            </span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-zinc-800/50 rounded-b">
            {answers.map((answerValue) => (
              <AnswerRow
                key={answerValue}
                answerValue={answerValue}
                surveyName={surveyName}
                questionName={questionName}
                pdiQuestionId={qMapping.pdiQuestionId}
                answerOptions={mappedPdiQuestion?.answerOptions ?? []}
                onSelect={handleAnswerSelect}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

interface AnswerRowProps {
  answerValue: string;
  surveyName: string;
  questionName: string;
  pdiQuestionId: string;
  answerOptions: PdiAnswerOption[];
  onSelect: (answerValue: string, optionId: string, pdiQuestionId: string) => void;
}

function AnswerRow({
  answerValue,
  surveyName,
  questionName,
  pdiQuestionId,
  answerOptions,
  onSelect,
}: AnswerRowProps) {
  const { state } = useApp();
  const aKeyFull = `${surveyName}||${questionName}||${answerValue}`;
  const aMapping: AnswerMappingEntry | undefined = state.answerMappings[aKeyFull];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
      <div className="w-44 flex-shrink-0 min-w-0">
        <p className="text-[11px] text-gray-700 dark:text-zinc-200 truncate" title={answerValue}>
          {answerValue}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-zinc-600 truncate">{questionName}</p>
      </div>

      <span className="text-gray-300 dark:text-zinc-700 text-[11px] flex-shrink-0">—</span>

      <div className="flex items-center gap-1 flex-shrink-0">
        {aMapping ? (
          <>
            <ConfidenceBadge confidence={aMapping.confidence} />
            <span className="text-[10px] px-1 rounded border leading-4 bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700/40">
              {aMapping.method === "user-selected" ? "manual" : "desc-match"}
            </span>
          </>
        ) : (
          <>
            <span className="text-[10px] px-1 rounded border leading-4 bg-gray-100 dark:bg-zinc-800/60 text-gray-400 dark:text-zinc-600 border-gray-200 dark:border-zinc-700/30">
              none
            </span>
            <span className="text-[10px] px-1 rounded border leading-4 bg-gray-100 dark:bg-zinc-800/60 text-gray-400 dark:text-zinc-600 border-gray-200 dark:border-zinc-700/30">
              unmatched
            </span>
          </>
        )}
      </div>

      <select
        value={aMapping?.pdiAnswerOptionId ?? ""}
        onChange={(e) => onSelect(answerValue, e.target.value, pdiQuestionId)}
        className="flex-1 text-[11px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-zinc-700/50 focus:outline-none focus:ring-1 focus:ring-green-500/40 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-200 cursor-pointer transition-colors"
      >
        <option value="">— unmapped —</option>
        {answerOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            [{opt.displayCode}] {opt.displayDescription}
          </option>
        ))}
      </select>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: "auto" | "manual" }) {
  if (confidence === "auto") {
    return (
      <span className="text-[10px] px-1.5 rounded border font-medium leading-4 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700/40">
        auto
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 rounded border font-medium leading-4 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40">
      manual
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const typeStyles: Record<string, string> = {
    "Non-Contact":
      "text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 border-cyan-300 dark:border-cyan-700/40",
    "Candidate Campaign":
      "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700/40",
    Other:
      "text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700/40",
  };
  const cls =
    typeStyles[type] ??
    "text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-zinc-800 border-gray-300 dark:border-zinc-700/40";
  return (
    <span className={`text-[10px] px-1.5 rounded border font-medium leading-5 ${cls}`}>{type.toLowerCase()}</span>
  );
}
