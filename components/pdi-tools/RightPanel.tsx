"use client";

import React from "react";
import { useApp } from "@/lib/pdi-tools/mapping-context";
import FlagInspector from "./FlagInspector";
import ExportPanel from "./ExportPanel";

export default function RightPanel() {
  const { state, dispatch } = useApp();

  const tabs: { id: "inspector" | "export"; label: string }[] = [
    { id: "inspector", label: "🏷 Flags" },
    { id: "export", label: "📋 Export" },
  ];

  return (
    <aside className="w-72 flex-shrink-0 flex flex-col border-l border-gray-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-900 overflow-hidden transition-colors">
      <div className="flex border-b border-gray-200 dark:border-zinc-700/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => dispatch({ type: "SET_RIGHT_TAB", tab: tab.id })}
            className={`flex-1 text-[11px] py-2 font-medium transition-colors ${
              state.rightTab === tab.id
                ? "border-b-2 border-green-500 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/10"
                : "text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {state.rightTab === "inspector" ? <FlagInspector /> : <ExportPanel />}
      </div>
    </aside>
  );
}
