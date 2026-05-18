"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useState, type ChangeEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import PhoneBankTable from "@/components/phonebanking/PhoneBankTable";
import TabBar from "@/components/phonebanking/TabBar";
import type { AllCampaignsDayDashboardPayload } from "@/lib/all-campaigns-day-dashboard";
import type { PhoneBankSummary } from "@/lib/types";
import { isValidIsoDate } from "@/lib/validation/iso-date";

const PbDashboardStack = dynamic(() => import("@/components/phonebanking/PbDashboardStack"), {
  ssr: false,
  loading: () => (
    <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
      Loading by-phone-bank dashboard…
    </p>
  ),
});

const PhonebankerAggregateTable = dynamic(
  () => import("@/components/phonebanking/PhonebankerAggregateTable"),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
        Loading phonebanker table…
      </p>
    ),
  }
);

/** Match `TABS` on `/phonebanking/[tag]` (first three — same labels, icons, ids). */
const DAY_TABS = [
  { id: "overview", label: "All Phonebanks", icon: "📊" },
  { id: "aggregate", label: "By Phone Bank", icon: "📋" },
  { id: "phonebankers", label: "Phonebankers", icon: "👥" },
] as const;

const ALL_DATE_PARAM = "allDate";
const ALL_TAB_PARAM = "allTab";
const TAB_OVERVIEW = DAY_TABS[0].id;
const TAB_AGGREGATE = DAY_TABS[1].id;
const TAB_PHONEBANKERS = DAY_TABS[2].id;

const LEGACY_TAB_ALIASES: Record<string, string> = {
  phonebanks: TAB_OVERVIEW,
};

function normalizeAllTab(raw: string): string {
  const head = raw.trim();
  const aliased = LEGACY_TAB_ALIASES[head] ?? head;
  if (DAY_TABS.some((t) => t.id === aliased)) return aliased;
  return TAB_OVERVIEW;
}

type ApiOk = {
  ok: true;
  data: {
    date: string;
    dashboard: AllCampaignsDayDashboardPayload;
  };
};

type Props = {
  defaultPhoneBanks: PhoneBankSummary[];
};

export default function AllCampaignsDaySection({ defaultPhoneBanks }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawDate = searchParams.get(ALL_DATE_PARAM)?.trim() ?? "";
  const allDate = isValidIsoDate(rawDate) ? rawDate : "";

  const rawTab = searchParams.get(ALL_TAB_PARAM)?.trim() ?? "";
  const activeTab = normalizeAllTab(rawTab);

  const [dayDashboard, setDayDashboard] = useState<AllCampaignsDayDashboardPayload | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);

  const replaceQuery = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const onDateInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (!v) {
        replaceQuery((p) => {
          p.delete(ALL_DATE_PARAM);
          p.delete(ALL_TAB_PARAM);
        });
        return;
      }
      if (!isValidIsoDate(v)) return;
      replaceQuery((p) => {
        p.set(ALL_DATE_PARAM, v);
        if (!p.get(ALL_TAB_PARAM)) p.set(ALL_TAB_PARAM, TAB_OVERVIEW);
      });
    },
    [replaceQuery]
  );

  const onClearDate = useCallback(() => {
    replaceQuery((p) => {
      p.delete(ALL_DATE_PARAM);
      p.delete(ALL_TAB_PARAM);
    });
  }, [replaceQuery]);

  useEffect(() => {
    if (!allDate) {
      setDayDashboard(null);
      setDayError(null);
      setDayLoading(false);
      return;
    }

    const ac = new AbortController();
    setDayLoading(true);
    setDayError(null);

    fetch(`/api/phonebanking/all-campaigns-day?date=${encodeURIComponent(allDate)}`, {
      signal: ac.signal,
    })
      .then(async (res) => {
        const json = (await res.json()) as ApiOk | { ok: false; error?: string };
        if (!res.ok || !json.ok) {
          const msg =
            "error" in json && typeof json.error === "string"
              ? json.error
              : `Request failed (${res.status})`;
          throw new Error(msg);
        }
        if (!("data" in json) || !json.data?.dashboard) throw new Error("Invalid response");
        setDayDashboard(json.data.dashboard);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setDayDashboard(null);
        setDayError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setDayLoading(false);
      });

    return () => ac.abort();
  }, [allDate]);

  const showDayUi = Boolean(allDate);
  const showTabs = showDayUi && !dayLoading && !dayError && dayDashboard !== null;

  const showDefaultFullWindowTable = !allDate;

  const d = dayDashboard;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <label className="flex flex-col gap-1 text-sm max-w-xs">
          <span className="font-medium text-gray-700 dark:text-gray-200">Filter by day (Pacific)</span>
          <input
            type="date"
            value={allDate}
            onChange={onDateInputChange}
            className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
          />
        </label>
        {allDate ? (
          <button
            type="button"
            onClick={onClearDate}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-300 hover:underline self-start sm:self-auto"
          >
            Clear date (full window)
          </button>
        ) : null}
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
        Leave the date empty for the usual all-time window list (since Dec 1, 2025). Choosing a day loads merged
        BigQuery + CSV from <strong className="font-medium text-gray-600 dark:text-gray-300">all candidate tags</strong>{" "}
        — same calculations as each candidate&rsquo;s dashboard for that Pacific day.
      </p>

      {dayError ? (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-200">
          Could not load day-scoped data: <span className="font-mono text-xs">{dayError}</span>
        </div>
      ) : null}

      {showTabs ? (
        <Suspense fallback={null}>
          <TabBar tabs={[...DAY_TABS]} paramKey={ALL_TAB_PARAM} defaultTab={TAB_OVERVIEW} />
        </Suspense>
      ) : null}

      {dayLoading && allDate ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading data for {allDate}…</p>
      ) : null}

      {showDefaultFullWindowTable ? (
        <PhoneBankTable
          phoneBanks={defaultPhoneBanks}
          emptyMessage="No campaigns with calls in the last two months matched the active lifecycle filter."
        />
      ) : null}

      {showTabs && activeTab === TAB_OVERVIEW && d ? (
        <section className="space-y-3">
          <h3 className="text-base font-semibold text-gray-700 dark:text-gray-200">All Phone Banks</h3>
          <PhoneBankTable
            phoneBanks={d.overviewPhoneBanks}
            emptyMessage={`No campaigns with activity on ${allDate} (BQ + CSV merge).`}
          />
        </section>
      ) : null}

      {showTabs && activeTab === TAB_AGGREGATE && d ? (
        <div className="space-y-3">
          <PbDashboardStack
            slices={d.filteredSlices}
            questionRowsBySlice={d.questionRowsBySlice}
            callerMetricsBySlice={d.callerMetricsBySlice}
            surveyScriptProfile={d.surveyScriptProfile}
            finalResultBucketsFootnoteLead={d.aggregateLexicon.finalResultBucketsFootnoteLead}
            verbatimFinalResultLabels={false}
            syntheticPivotAllowlistByQuestion={d.syntheticPivotAllowlistByQuestion}
            widePivotHeaderOrderHint={d.widePivotHeaderOrderHint}
            exportFilenameDate={allDate}
          />
        </div>
      ) : null}

      {showTabs && activeTab === TAB_PHONEBANKERS && d ? (
        <PhonebankerAggregateTable
          rows={d.mergedRowsForPhonebankers}
          otherPositiveColumnLabel={d.aggregateLexicon.phonebankerOtherPositiveColumnLabel}
          extraWideColumnOrder={d.extraWideColumnOrder}
        />
      ) : null}
    </div>
  );
}
