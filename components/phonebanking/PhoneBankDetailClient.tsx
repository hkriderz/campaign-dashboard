"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import PhoneBankStats from "./PhoneBankStats";
import PhonebankerTable from "./PhonebankerTable";
import DayFilterBar from "./DayFilterBar";
import type { PhoneBankDetail, PhonebankerAggregateStat } from "@/lib/types";

const PhonebankerBarChart = dynamic(() => import("./PhonebankerBarChart"), {
  ssr: false,
  loading: () => (
    <div
      className="h-[320px] w-full rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse"
      aria-hidden
    />
  ),
});

type Props = {
  detail: PhoneBankDetail;
  tagColor: string;
  tagId?: string;
};

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return "—";
  if (!end || end === start) return start;
  return `${start} → ${end}`;
}

export default function PhoneBankDetailClient({ detail, tagColor: _tagColor, tagId }: Props) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    const update = () => setIsDarkMode(html.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const scopedRows = useMemo(
    () =>
      selectedDate
        ? detail.dailyStats.filter((r) => r.callDate === selectedDate)
        : detail.dailyStats,
    [detail.dailyStats, selectedDate]
  );

  const headerStats = useMemo(() => {
    const callers = new Set(scopedRows.map((r) => r.phonebankerName));
    const surveyed = scopedRows.reduce((s, r) => s + r.surveyed, 0);
    const callSeconds = scopedRows.reduce((s, r) => s + r.totalCallSeconds, 0);
    const dayCalls = scopedRows.reduce((max, r) => Math.max(max, r.campaignDayRawCalls ?? 0), 0);
    return {
      phoneBanks: 1,
      totalCalls: selectedDate ? dayCalls : detail.campaign.totalCalls,
      surveyed,
      callHours: Math.round((callSeconds / 3600) * 100) / 100,
      callers: callers.size,
      uniqueCallers: detail.campaign.uniqueCallers,
    };
  }, [detail.campaign.totalCalls, detail.campaign.uniqueCallers, scopedRows, selectedDate]);

  const chartData: PhonebankerAggregateStat[] = selectedDate
    ? (() => {
        const aggMap = new Map<string, PhonebankerAggregateStat>();
        for (const row of scopedRows) {
          if (!aggMap.has(row.phonebankerName)) {
            aggMap.set(row.phonebankerName, {
              phonebankerName: row.phonebankerName,
              totalDials: 0,
              totalCallHours: 0,
              totalDialerHours: 0,
              surveyed: 0,
              strongSupport: 0,
              daysWorked: 0,
              campaigns: [detail.campaign.campaignName],
            });
          }
          const agg = aggMap.get(row.phonebankerName)!;
          agg.totalDials += row.numDials;
          agg.totalCallHours =
            Math.round((agg.totalCallHours + row.totalCallHours) * 100) / 100;
          agg.totalDialerHours =
            Math.round((agg.totalDialerHours + row.totalDialerHours) * 100) / 100;
          agg.surveyed += row.surveyed;
          agg.strongSupport += row.strongSupport;
        }
        return Array.from(aggMap.values());
      })()
    : detail.phonebankerAggregates;

  const rangeLabel = selectedDate
    ? selectedDate
    : formatDateRange(detail.campaign.firstCallDate, detail.campaign.lastCallDate);

  return (
    <div className="space-y-8">
      <PhoneBankStats stats={headerStats} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {detail.availableDates.length > 1 ? (
          <DayFilterBar
            dates={detail.availableDates}
            selectedDate={selectedDate}
            onChange={setSelectedDate}
          />
        ) : (
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Date range
          </span>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap sm:text-right">
          {rangeLabel}
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">
          Phonebankers
          {selectedDate && (
            <span className="ml-2 text-sm font-normal text-indigo-500">
              — {selectedDate}
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Hours on dialer vs in calls, surveyed, and strong supports
          {selectedDate ? " on this day" : " across all days"}
        </p>
        <PhonebankerBarChart data={chartData} darkMode={isDarkMode} />
      </div>

      <div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">
          Breakdown
          {selectedDate ? (
            <span className="ml-2 text-sm font-normal text-indigo-500">— {selectedDate}</span>
          ) : null}
        </h2>
        <PhonebankerTable
          rows={scopedRows}
          selectedDate={selectedDate}
          tagId={tagId}
          campaignId={detail.campaign.campaignId}
        />
      </div>
    </div>
  );
}
