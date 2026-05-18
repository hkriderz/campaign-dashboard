"use client";

import React, { useRef, useEffect, useState } from "react";
import { useApp } from "@/lib/pdi-tools/mapping-context";
import {
  loadMappingFromJson,
  buildMappingOutput,
  downloadMappingJson,
  saveMappingExportToApp,
} from "@/lib/pdi-tools/export-mapping";
import type { MappingOutput } from "@/lib/pdi-tools/types";

export default function DataLoader() {
  const { state, dispatch, refreshFromApi } = useApp();
  const mappingFileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  useEffect(() => {
    if (!state.lastRefreshedAt) return;
    const pdiCount = state.pdiQuestions.length;
    const stwCount = Object.keys(state.stwData).length;
    setToast(`✓ Refreshed — ${pdiCount} PDI, ${stwCount} surveys`);
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [state.lastRefreshedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleMappingFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string) as MappingOutput;
        const { questionMappings, answerMappings } = loadMappingFromJson(raw);
        dispatch({ type: "LOAD_MAPPING", questionMappings, answerMappings });
      } catch {
        dispatch({ type: "SET_LOAD_ERROR", error: "Failed to parse mapping file." });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleExport() {
    const output = buildMappingOutput(
      state.pdiQuestions,
      state.stwData,
      state.questionMappings,
      state.answerMappings
    );
    const result = await saveMappingExportToApp(output);
    if (result.ok) {
      setToast(`✓ Saved ${result.saved?.fileName ?? "mapping"} to pdi-mappings`);
    } else {
      setToast(result.error ?? "Export save failed");
    }
    downloadMappingJson(output);
  }

  const pdiCount = state.pdiQuestions.length;
  const stwCount = Object.keys(state.stwData).length;
  const hasMappings = Object.keys(state.questionMappings).length > 0;

  return (
    <header className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700/50 min-h-[52px] transition-colors">
      <div className="flex-shrink-0">
        <p className="text-[15px] font-bold text-green-600 dark:text-green-400 leading-tight">🗺 PDI Magic Mapper</p>
        <p className="text-[11px] text-gray-400 dark:text-zinc-500 leading-tight mt-0.5">
          Scale to Win → PDI schema unifier
        </p>
      </div>

      <div className="flex-1" />

      {toast ? (
        <span className="text-[11px] text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700/50 px-2 py-0.5 rounded">
          {toast}
        </span>
      ) : null}
      {state.loadError && !toast ? (
        <span className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700/50 px-2 py-0.5 rounded max-w-md truncate">
          ⚠ {state.loadError}
        </span>
      ) : null}

      <div className="flex items-center gap-1.5">
        <CountPill label="PDI" count={pdiCount} unit="q" loaded={pdiCount > 0} />
        <CountPill label="STW" count={stwCount} unit=" surveys" loaded={stwCount > 0} />
      </div>

      <div className="w-px h-4 bg-gray-200 dark:bg-zinc-700/60 flex-shrink-0" />

      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        <button
          type="button"
          onClick={() => void refreshFromApi()}
          disabled={state.isRefreshing}
          title="Refresh data from live API"
          className="text-[11px] px-2.5 py-1 rounded border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:border-gray-400 dark:hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {state.isRefreshing ? "Refreshing…" : "⟳ Refresh"}
        </button>

        {hasMappings ? (
          confirmClearAll ? (
            <div className="flex items-center gap-1 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700/50 rounded px-2 py-0.5">
              <span className="text-[11px] text-red-600 dark:text-red-400">Clear ALL?</span>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "CLEAR_ALL" });
                  setConfirmClearAll(false);
                }}
                className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors"
              >
                Yes
              </button>
              <span className="text-gray-300 dark:text-zinc-600 text-[11px]">·</span>
              <button
                type="button"
                onClick={() => setConfirmClearAll(false)}
                className="text-[11px] text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="text-[11px] px-2.5 py-1 rounded border border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-red-400 dark:hover:border-red-600/60 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              🗑 Clear All
            </button>
          )
        ) : null}

        <input ref={mappingFileRef} type="file" accept=".json" className="hidden" onChange={handleMappingFileUpload} />
        <button
          type="button"
          onClick={() => mappingFileRef.current?.click()}
          className="text-[11px] px-2.5 py-1 rounded border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:border-gray-400 dark:hover:border-zinc-500 transition-colors"
        >
          📂 Load Mapping
        </button>

        <button
          type="button"
          onClick={handleExport}
          className="text-[11px] px-2.5 py-1 rounded bg-green-600 hover:bg-green-500 text-white font-medium transition-colors"
        >
          ⬇ Export Mapping
        </button>
      </div>
    </header>
  );
}

function CountPill({
  label,
  count,
  unit,
  loaded,
}: {
  label: string;
  count: number;
  unit: string;
  loaded: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded font-mono font-medium border ${
        loaded
          ? "border-green-500/60 dark:border-green-700/60 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
          : "border-gray-300 dark:border-zinc-700 text-gray-400 dark:text-zinc-500 bg-gray-50 dark:bg-zinc-800/50"
      }`}
    >
      {label}
      {loaded ? ` ${count}${unit}` : " —"}
    </span>
  );
}
