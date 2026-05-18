"use client";

import React, { useState, useMemo } from "react";
import { useApp } from "@/lib/pdi-tools/mapping-context";
import { buildFlagRegistry } from "@/lib/pdi-tools/flag-registry";
import type { FlagScope } from "@/lib/pdi-tools/types";

const SCOPE_LABELS: Record<FlagScope, { label: string; cls: string }> = {
  generic: {
    label: "Generic",
    cls: "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/40",
  },
  "question-specific": {
    label: "Question-Specific",
    cls: "text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700/40",
  },
  operational: {
    label: "Operational",
    cls: "text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700/40",
  },
  demographic: {
    label: "Demographic",
    cls: "text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-700/40",
  },
};

const SCOPES: (FlagScope | "all")[] = ["all", "generic", "question-specific", "operational", "demographic"];

export default function FlagInspector() {
  const { state } = useApp();
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<FlagScope | "all">("all");

  const registry = useMemo(() => buildFlagRegistry(state.pdiQuestions), [state.pdiQuestions]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return registry.filter((f) => {
      const matchesScope = scopeFilter === "all" || f.scope === scopeFilter;
      const matchesSearch = !q || f.code.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q);
      return matchesScope && matchesSearch;
    });
  }, [registry, search, scopeFilter]);

  if (state.pdiQuestions.length === 0) {
    return <div className="p-4 text-center text-[11px] text-gray-400 dark:text-zinc-600">Load PDI Questions to inspect flags.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 dark:border-zinc-700/50">
        <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
          Flag Inspector ({registry.length} flags)
        </p>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search flags…"
          className="w-full text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-green-500/40 bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 mb-2 transition-colors"
        />
        <div className="flex flex-wrap gap-1">
          {SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setScopeFilter(scope)}
              className={`text-[10px] px-2 py-0.5 rounded border font-medium transition-colors ${
                scopeFilter === scope
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-white dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200"
              }`}
            >
              {scope === "all" ? "All" : SCOPE_LABELS[scope as FlagScope].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-gray-400 dark:text-zinc-600">No flags match filters.</div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-zinc-800/60">
            {filtered.map((flag) => {
              const { label, cls } = SCOPE_LABELS[flag.scope];
              return (
                <li key={flag.flagId} className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                  <div className="flex items-start gap-2">
                    <code className="text-[11px] font-mono font-bold text-green-700 dark:text-green-400 w-14 truncate flex-shrink-0">
                      {flag.code}
                    </code>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-700 dark:text-zinc-200 truncate" title={flag.desc}>
                        {flag.desc}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[9px] px-1.5 rounded border font-medium leading-4 ${cls}`}>{label}</span>
                        <span className="text-[9px] text-gray-400 dark:text-zinc-600">{flag.usedInNQuestions}q</span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
