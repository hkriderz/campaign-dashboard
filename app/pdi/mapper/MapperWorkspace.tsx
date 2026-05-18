"use client";

import { AppProvider, useApp } from "@/lib/pdi-tools/mapping-context";
import DataLoader from "@/components/pdi-tools/DataLoader";
import SurveySidebar from "@/components/pdi-tools/SurveySidebar";
import SurveyMapper from "@/components/pdi-tools/SurveyMapper";
import RightPanel from "@/components/pdi-tools/RightPanel";

function MapperBody() {
  const { state } = useApp();

  return (
    <>
      {state.isRefreshing && !state.dataLoaded ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-zinc-950 min-h-[50vh]">
          <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-[11px] text-gray-400 dark:text-zinc-500">Loading data…</p>
        </div>
      ) : null}

      {state.dataLoaded ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <SurveySidebar />
          <SurveyMapper />
          <RightPanel />
        </div>
      ) : null}

      {!state.dataLoaded && !state.isRefreshing ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 min-h-[50vh]">
          {state.loadError ? (
            <>
              <div className="text-3xl opacity-40">⚠️</div>
              <p className="text-[12px] font-semibold text-red-600 dark:text-red-400">Failed to load data</p>
              <p className="text-[11px] text-gray-500 dark:text-zinc-500 text-center max-w-md leading-relaxed">
                {state.loadError}
                <br />
                <br />
                Use <strong className="text-gray-700 dark:text-zinc-300">⟳ Refresh</strong> for live BigQuery + PDI API, or load{" "}
                <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-gray-700 dark:text-zinc-300">
                  pdi_questions.ndjson
                </code>{" "}
                and{" "}
                <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-gray-700 dark:text-zinc-300">
                  stw_surveys.ndjson
                </code>{" "}
                from the sidebar (see <code className="px-1 rounded">PDI_TOOLS_DATA_DIR</code> in README).
              </p>
            </>
          ) : (
            <>
              <div className="text-3xl opacity-20">🗺</div>
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
      <div className="flex flex-col flex-1 min-h-0 bg-gray-100 dark:bg-zinc-950">
        <DataLoader />
        <MapperBody />
      </div>
    </AppProvider>
  );
}
