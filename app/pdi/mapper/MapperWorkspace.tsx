"use client";

import { useState } from "react";
import { AppProvider, useApp } from "@/lib/pdi-tools/mapping-context";
import DataLoader from "@/components/pdi-tools/DataLoader";
import SurveySidebar from "@/components/pdi-tools/SurveySidebar";
import SurveyMapper from "@/components/pdi-tools/SurveyMapper";
import RightPanel from "@/components/pdi-tools/RightPanel";

type MobilePane = "surveys" | "map" | "tools";

const MOBILE_TABS: { id: MobilePane; label: string }[] = [
  { id: "surveys", label: "Surveys" },
  { id: "map", label: "Map" },
  { id: "tools", label: "Flags & export" },
];

function MapperBody() {
  const { state } = useApp();
  const [mobilePane, setMobilePane] = useState<MobilePane>("map");

  return (
    <>
      {state.isRefreshing && !state.dataLoaded ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-[var(--section-paper)] min-h-[50vh]">
          <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-[11px] text-gray-400 dark:text-zinc-500">Loading data…</p>
        </div>
      ) : null}

      {state.dataLoaded ? (
        <>
          <div className="lg:hidden flex border-b border-gray-200 dark:border-[var(--section-rule)] bg-white dark:bg-[color-mix(in_srgb,var(--section-paper)_80%,#000)] shrink-0">
            {MOBILE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMobilePane(tab.id)}
                className={`flex-1 min-h-11 text-xs sm:text-sm font-medium py-2 px-2 border-b-2 transition-colors ${
                  mobilePane === tab.id
                    ? "border-[var(--section-accent)] text-[var(--section-ink)] bg-[color-mix(in_srgb,var(--section-accent)_10%,transparent)]"
                    : "border-transparent text-[var(--section-muted)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 min-h-0 overflow-hidden flex-col lg:flex-row">
            <div
              className={`${mobilePane === "surveys" ? "flex" : "hidden"} lg:flex flex-col min-h-0 flex-1 lg:flex-none lg:max-h-full`}
            >
              <SurveySidebar />
            </div>
            <div
              className={`${mobilePane === "map" ? "flex" : "hidden"} lg:flex flex-col min-h-0 flex-1 min-w-0`}
            >
              <SurveyMapper />
            </div>
            <div
              className={`${mobilePane === "tools" ? "flex" : "hidden"} lg:flex flex-col min-h-0 flex-1 lg:flex-none lg:max-h-full`}
            >
              <RightPanel />
            </div>
          </div>
        </>
      ) : null}

      {!state.dataLoaded && !state.isRefreshing ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 sm:p-8 min-h-[50vh]">
          {state.loadError ? (
            <>
              <div className="text-3xl opacity-40" aria-hidden>
                ⚠️
              </div>
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">Failed to load data</p>
              <p className="text-xs sm:text-[11px] text-gray-500 dark:text-zinc-500 text-center max-w-md leading-relaxed px-2">
                {state.loadError}
                <br />
                <br />
                {state.channel === "text" ? (
                  <>
                    Text mode loads every tagged text campaign from BigQuery (<code className="px-1 rounded">l11_stw_txt</code>). Use{" "}
                    <strong className="text-gray-700 dark:text-zinc-300">⟳ Refresh</strong> after credentials are set.
                  </>
                ) : (
                  <>
                    Use <strong className="text-gray-700 dark:text-zinc-300">⟳ Refresh</strong> for live BigQuery + PDI API, or load{" "}
                    <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-gray-700 dark:text-zinc-300">
                      pdi_questions.ndjson
                    </code>{" "}
                    and{" "}
                    <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-gray-700 dark:text-zinc-300">
                      stw_surveys.ndjson
                    </code>{" "}
                    from the Surveys tab (see <code className="px-1 rounded">PDI_TOOLS_DATA_DIR</code> in README).
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <div className="text-3xl opacity-20" aria-hidden>
                🗺
              </div>
              <p className="text-[11px] text-gray-500 dark:text-zinc-600">Loading cached data from NDJSON files…</p>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

export default function MapperWorkspace() {
  return (
    <AppProvider>
      <div className="flex flex-col flex-1 min-h-0 bg-gray-100 dark:bg-[var(--section-paper)]">
        <DataLoader />
        <MapperBody />
      </div>
    </AppProvider>
  );
}
