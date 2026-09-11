"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { PhonebankerAggregateStat } from "@/lib/types";

type Props = {
  data: PhonebankerAggregateStat[];
  darkMode?: boolean;
};

type TooltipPayloadEntry = {
  dataKey: string;
  color: string;
  value: number;
};

const SERIES_LABELS: Record<string, string> = {
  totalDialerHours: "Hrs on dialer",
  totalCallHours: "Hrs on calls",
  surveyed: "Surveyed",
  strongSupport: "Strong Supports",
};

const SERIES_SWATCHES: Record<string, { light: string; dark: string }> = {
  totalDialerHours: { light: "#64748b", dark: "#94a3b8" },
  totalCallHours: { light: "#10b981", dark: "#45d399" },
  surveyed: { light: "#0ea5e9", dark: "#7dd3fc" },
  strongSupport: { light: "#16a34a", dark: "#4ade80" },
};

function isHoursKey(dataKey: string): boolean {
  return dataKey === "totalDialerHours" || dataKey === "totalCallHours";
}

function CustomTooltip({
  active,
  payload,
  label,
  darkMode,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  darkMode?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={`border rounded-xl p-3 text-sm min-w-[180px] ${
        darkMode
          ? "bg-gray-900 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          : "bg-white border-gray-200 shadow-lg"
      }`}
    >
      <p
        className={`font-semibold mb-1.5 truncate max-w-[220px] ${
          darkMode ? "text-gray-100" : "text-gray-900"
        }`}
      >
        {label}
      </p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex justify-between gap-4">
          <span style={{ color: entry.color }} className="font-medium">
            {SERIES_LABELS[entry.dataKey] ?? entry.dataKey}
          </span>
          <span className={`font-mono ${darkMode ? "text-gray-200" : "text-gray-800"}`}>
            {isHoursKey(entry.dataKey)
              ? `${Number(entry.value).toFixed(2)}h`
              : Number(entry.value).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function PhonebankerBarChart({ data, darkMode = false }: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400 text-sm">
        No phonebanker data for this selection.
      </div>
    );
  }

  const chartData = [...data]
    .sort(
      (a, b) =>
        b.strongSupport - a.strongSupport ||
        b.surveyed - a.surveyed ||
        a.phonebankerName.localeCompare(b.phonebankerName)
    )
    .map((d) => ({
      ...d,
      shortName:
        d.phonebankerName.length > 16
          ? d.phonebankerName.slice(0, 14) + "…"
          : d.phonebankerName,
    }));

  const tickFill = darkMode ? "#9ca3af" : "#6b7280";

  return (
    <div className="w-full min-w-0">
      <div className="w-full h-64 sm:h-[360px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 0, bottom: 64 }}
          barCategoryGap="18%"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={darkMode ? "#374151" : "#f0f0f0"}
            vertical={false}
          />

          <XAxis
            dataKey="shortName"
            tick={{ fontSize: 11, fill: tickFill }}
            angle={-40}
            textAnchor="end"
            interval="preserveStartEnd"
            height={76}
          />

          <YAxis
            yAxisId="hours"
            orientation="left"
            tick={{ fontSize: 11, fill: tickFill }}
            tickFormatter={(v: number) => `${v.toFixed(1)}h`}
            width={52}
          />

          <YAxis
            yAxisId="counts"
            orientation="right"
            tick={{ fontSize: 11, fill: tickFill }}
            tickFormatter={(v: number) => v.toLocaleString()}
            width={48}
          />

          <Tooltip
            content={<CustomTooltip darkMode={darkMode} />}
            cursor={{ fill: darkMode ? "#1f2937" : "#f5f3ff" }}
          />

          <Bar
            yAxisId="hours"
            dataKey="totalDialerHours"
            name="totalDialerHours"
            fill={darkMode ? "#94a3b8" : "#64748b"}
            radius={[3, 3, 0, 0]}
            maxBarSize={22}
          />
          <Bar
            yAxisId="hours"
            dataKey="totalCallHours"
            name="totalCallHours"
            fill={darkMode ? "#45d399" : "#10b981"}
            radius={[3, 3, 0, 0]}
            maxBarSize={22}
          />
          <Bar
            yAxisId="counts"
            dataKey="surveyed"
            name="surveyed"
            fill={darkMode ? "#7dd3fc" : "#0ea5e9"}
            radius={[3, 3, 0, 0]}
            maxBarSize={22}
          />
          <Bar
            yAxisId="counts"
            dataKey="strongSupport"
            name="strongSupport"
            fill={darkMode ? "#4ade80" : "#16a34a"}
            radius={[3, 3, 0, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        {Object.entries(SERIES_LABELS).map(([key, label]) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: darkMode ? SERIES_SWATCHES[key]!.dark : SERIES_SWATCHES[key]!.light }}
            />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
