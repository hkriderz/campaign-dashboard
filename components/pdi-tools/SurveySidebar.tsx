"use client";

import React, { useRef, useState, useMemo } from "react";
import { useApp } from "@/lib/pdi-tools/mapping-context";
import { parseNdjson, buildStwData } from "@/lib/pdi-tools/parse-ndjson";
import type { PdiQuestion, StwRow } from "@/lib/pdi-tools/types";

type CompletionFilter = "all" | "filled" | "empty";

export default function SurveySidebar() {
  const { state, dispatch } = useApp();
  const pdiFileRef = useRef<HTMLInputElement>(null);
  const stwFileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>("all");

  const surveyNames = useMemo(() => Object.keys(state.stwData).sort(), [state.stwData]);

  function handlePdiUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const questions = parseNdjson<PdiQuestion>(ev.target?.result as string);
        dispatch({ type: "LOAD_DATA", pdiQuestions: questions, stwData: state.stwData });
      } catch {
        dispatch({ type: "SET_LOAD_ERROR", error: "Failed to parse PDI file." });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleStwUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseNdjson<StwRow>(ev.target?.result as string);
        dispatch({ type: "LOAD_DATA", pdiQuestions: state.pdiQuestions, stwData: buildStwData(rows) });
      } catch {
        dispatch({ type: "SET_LOAD_ERROR", error: "Failed to parse STW file." });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function getSurveyStats(surveyName: string) {
    const questions = state.stwData[surveyName] ?? {};
    const questionNames = Object.keys(questions);
    const totalQ = questionNames.length;
    const mappedQ = questionNames.filter((q) => state.questionMappings[`${surveyName}||${q}`]).length;
    let totalA = 0;
    let mappedA = 0;
    for (const q of questionNames) {
      const answers = questions[q];
      totalA += answers.length;
      for (const a of answers) {
        if (state.answerMappings[`${surveyName}||${q}||${a}`]) mappedA++;
      }
    }
    return { mappedQ, totalQ, mappedA, totalA };
  }

  function matchesCompletionFilter(surveyName: string, filter: CompletionFilter): boolean {
    if (filter === "all") return true;
    const { mappedQ, totalQ, mappedA, totalA } = getSurveyStats(surveyName);
    const filled = totalQ > 0 && totalA > 0 && mappedQ === totalQ && mappedA === totalA;
    const empty = mappedQ === 0 && mappedA === 0;
    return filter === "filled" ? filled : empty;
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return surveyNames.filter((n) => {
      const matchesSearch = !q || n.toLowerCase().includes(q);
      return matchesSearch && matchesCompletionFilter(n, completionFilter);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyNames, search, completionFilter, state.questionMappings, state.answerMappings]);

  const pdiCount = state.pdiQuestions.length;
  const stwRecords = Object.values(state.stwData).reduce(
    (sum, qs) => sum + Object.values(qs).reduce((s, ans) => s + ans.length, 0),
    0
  );

  return (
    <aside className="w-full lg:w-64 lg:flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-900 overflow-hidden transition-colors min-h-0">
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-zinc-700/50">
        <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
          Data Files
        </p>
        <div className="space-y-1.5 mb-2.5">
          <FileRow label="pdi_questions.ndjson" count={pdiCount > 0 ? `${pdiCount} questions` : null} loaded={pdiCount > 0} />
          <FileRow
            label="stw_surveys.ndjson"
            count={stwRecords > 0 ? `${stwRecords.toLocaleString()} records` : null}
            loaded={stwRecords > 0}
          />
        </div>
        <div className="flex gap-1.5">
          <input
            ref={pdiFileRef}
            type="file"
            accept=".ndjson,.jsonl,.json"
            className="hidden"
            onChange={handlePdiUpload}
          />
          <button
            type="button"
            onClick={() => pdiFileRef.current?.click()}
            className="flex-1 text-[11px] py-1 rounded border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:border-gray-400 dark:hover:border-zinc-500 transition-colors"
          >
            📂 Load PDI
          </button>
          <input
            ref={stwFileRef}
            type="file"
            accept=".ndjson,.jsonl,.json"
            className="hidden"
            onChange={handleStwUpload}
          />
          <button
            type="button"
            onClick={() => stwFileRef.current?.click()}
            className="flex-1 text-[11px] py-1 rounded border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:border-gray-400 dark:hover:border-zinc-500 transition-colors"
          >
            📂 Load STW
          </button>
        </div>
      </div>

      <div className="px-3 pt-2.5 pb-2 border-b border-gray-200 dark:border-zinc-700/50">
        <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">
          STW Surveys ({surveyNames.length})
        </p>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter surveys…"
          className="w-full text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-green-500/40 bg-gray-50 dark:bg-zinc-800 dark:bg-zinc-900 text-gray-800 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 transition-colors"
        />
        <div className="mt-2 grid grid-cols-3 gap-1">
          {(["all", "filled", "empty"] as CompletionFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setCompletionFilter(filter)}
              className={`text-[10px] rounded border px-1.5 py-1 font-medium capitalize transition-colors ${
                completionFilter === filter
                  ? "border-green-500 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                  : "border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {Object.keys(state.stwData).length === 0 ? (
          <p className="px-3 py-5 text-center text-[11px] text-gray-400 dark:text-zinc-600">
            No survey data loaded.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-gray-400 dark:text-zinc-600">
            No surveys match the current filter.
          </p>
        ) : (
          <ul>
            {filtered.map((name) => {
              const { mappedQ, totalQ, mappedA, totalA } = getSurveyStats(name);
              const isActive = state.activeSurvey === name;
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "SET_ACTIVE_SURVEY", survey: name })}
                    className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-zinc-800/80 transition-colors border-l-2 ${
                      isActive
                        ? "bg-green-50 dark:bg-green-900/20 border-l-green-500"
                        : "border-l-transparent hover:bg-gray-50 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    <p
                      className={`text-[11px] leading-snug truncate mb-1 ${
                        isActive ? "text-green-700 dark:text-green-400 font-medium" : "text-gray-700 dark:text-zinc-200"
                      }`}
                      title={name}
                    >
                      {name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <QABadge label="Q" mapped={mappedQ} total={totalQ} />
                      <QABadge label="A" mapped={mappedA} total={totalA} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function FileRow({ label, count, loaded }: { label: string; count: string | null; loaded: boolean }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className={`text-[10px] flex-shrink-0 ${loaded ? "text-green-600 dark:text-green-500" : "text-gray-300 dark:text-zinc-600"}`}
      >
        {loaded ? "✓" : "○"}
      </span>
      <span className="text-[11px] text-gray-600 dark:text-zinc-300 font-mono truncate flex-1">{label}</span>
      {count ? (
        <span className="text-[10px] text-gray-400 dark:text-zinc-500 whitespace-nowrap flex-shrink-0">{count}</span>
      ) : null}
    </div>
  );
}

function QABadge({ label, mapped, total }: { label: string; mapped: number; total: number }) {
  const complete = total > 0 && mapped === total;
  const partial = mapped > 0 && !complete;
  return (
    <span
      className={`text-[10px] font-mono px-1 rounded leading-5 ${
        complete
          ? "text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30"
          : partial
            ? "text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/20"
            : "text-gray-400 dark:text-zinc-600 bg-gray-100 dark:bg-zinc-800"
      }`}
    >
      {label}: {mapped}/{total}
    </span>
  );
}
