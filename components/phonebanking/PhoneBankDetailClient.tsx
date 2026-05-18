"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
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
};

export default function PhoneBankDetailClient({ detail, tagColor }: Props) {
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

  // For the bar chart: if a day is selected, aggregate only that day's daily rows
  const chartData: PhonebankerAggregateStat[] = selectedDate
    ? (() => {
        const dayRows = detail.dailyStats.filter(
          (r) => r.callDate === selectedDate
        );
        const aggMap = new Map<string, PhonebankerAggregateStat>();
        for (const row of dayRows) {
          if (!aggMap.has(row.phonebankerName)) {
            aggMap.set(row.phonebankerName, {
              phonebankerName: row.phonebankerName,
              totalDials: 0,
              totalCallHours: 0,
              totalDialerHours: 0,
              daysWorked: 0,
              campaigns: [detail.campaign.campaignName],
            });
          }
          const agg = aggMap.get(row.phonebankerName)!;
          agg.totalDials += row.numDials;
          agg.totalCallHours =
            Math.round((agg.totalCallHours + row.totalCallHours) * 100) / 100;
        }
        return Array.from(aggMap.values()).sort(
          (a, b) => b.totalDials - a.totalDials
        );
      })()
    : detail.phonebankerAggregates;

  return (
    <div className="space-y-8">
      {/* Campaign stats */}
      <PhoneBankStats campaign={detail.campaign} />

      {/* Day filter */}
      {detail.availableDates.length > 1 && (
        <div>
          <DayFilterBar
            dates={detail.availableDates}
            selectedDate={selectedDate}
            onChange={setSelectedDate}
          />
        </div>
      )}

      {/* Bar chart */}
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
          Dials and call hours per phonebanker
          {selectedDate ? " on this day" : " across all days"}
        </p>
        <PhonebankerBarChart
          data={chartData}
          tagColor={tagColor}
          showHours={true}
          darkMode={isDarkMode}
        />
      </div>

      {/* Table */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-3">
          Daily Breakdown
        </h2>
        <PhonebankerTable
          rows={detail.dailyStats}
          selectedDate={selectedDate}
        />
      </div>
    </div>
  );
}
