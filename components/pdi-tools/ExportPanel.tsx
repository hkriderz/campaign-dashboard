"use client";

import React, { useMemo, useState } from "react";
import { useApp } from "@/lib/pdi-tools/mapping-context";
import {
  buildMappingOutput,
  downloadMappingJson,
  saveMappingExportToApp,
} from "@/lib/pdi-tools/export-mapping";

export default function ExportPanel() {
  const { state } = useApp();
  const [copied, setCopied] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const output = useMemo(
    () =>
      buildMappingOutput(state.pdiQuestions, state.stwData, state.questionMappings, state.answerMappings),
    [state.pdiQuestions, state.stwData, state.questionMappings, state.answerMappings]
  );

  const preview = useMemo(
    () => JSON.stringify(output, null, 2).split("\n").slice(0, 40).join("\n") + "\n…",
    [output]
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(output, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }

  async function handleSaveToApp() {
    setSaveBusy(true);
    setSaveMessage(null);
    try {
      const result = await saveMappingExportToApp(output);
      if (!result.ok) {
        setSaveMessage(result.error ?? "Save failed");
        return;
      }
      setSaveMessage(`Saved ${result.saved?.fileName ?? "mapping"} to pdi-mappings`);
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaveBusy(false);
    }
  }

  const { totalQuestionMappings, totalAnswerMappings, surveys } = output.stats;
  const totalSurveys = Object.keys(state.stwData).length;

  const unmappedAnswers = Object.entries(state.questionMappings).reduce((acc, [key]) => {
    const [surveyName, questionName] = key.split("||");
    const answers = state.stwData[surveyName]?.[questionName] ?? [];
    const unmapped = answers.filter((a) => !state.answerMappings[`${key}||${a}`]).length;
    return acc + unmapped;
  }, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-3 border-b border-gray-100 dark:border-zinc-700/50">
        <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-2.5">
          Export Mapping
        </p>
        <p className="text-[10px] text-gray-500 dark:text-zinc-500 mb-2 leading-relaxed">
          Saves to <code className="text-emerald-700 dark:text-emerald-400">pdi-mappings/</code> for the Syncer.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <StatCard label="Questions mapped" value={totalQuestionMappings} />
          <StatCard label="Answers mapped" value={totalAnswerMappings} />
          <StatCard label="Surveys covered" value={surveys} total={totalSurveys} />
          <StatCard label="Answers unmapped" value={unmappedAnswers} warn={unmappedAnswers > 0} />
        </div>
      </div>

      <div className="px-3 py-2.5 border-b border-gray-100 dark:border-zinc-700/50 flex flex-col gap-1.5">
        <button
          type="button"
          disabled={saveBusy}
          onClick={() => void handleSaveToApp()}
          className="w-full text-[11px] py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors disabled:opacity-50"
        >
          {saveBusy ? "Saving…" : "Save to pdi-mappings"}
        </button>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="flex-1 dash-action-btn dash-action-btn-sm dash-action-btn-copy py-1"
          >
            {copied ? "✓ Copied!" : "Copy JSON"}
          </button>
          <button
            type="button"
            onClick={() => downloadMappingJson(output)}
            className="flex-1 dash-action-btn dash-action-btn-sm dash-action-btn-download py-1"
          >
            Download copy
          </button>
        </div>
        {saveMessage ? (
          <p
            className={`text-[10px] ${saveMessage.startsWith("Saved") ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {saveMessage}
          </p>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        <pre className="text-[10px] font-mono text-gray-400 dark:text-zinc-600 p-3 leading-relaxed whitespace-pre-wrap break-all">
          {preview}
        </pre>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  total,
  warn,
}: {
  label: string;
  value: number;
  total?: number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded px-2.5 py-2 border ${
        warn && value > 0
          ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40"
          : "bg-gray-50 dark:bg-zinc-800/50 border-gray-200 dark:border-zinc-700/50"
      }`}
    >
      <p
        className={`text-base font-bold leading-none ${
          warn && value > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-800 dark:text-zinc-100"
        }`}
      >
        {value}
        {total !== undefined ? (
          <span className="text-[10px] font-normal text-gray-400 dark:text-zinc-500"> /{total}</span>
        ) : null}
      </p>
      <p className="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}
