"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { PhonebankerAggregateStat } from "@/lib/types";

type Props = {
  data: PhonebankerAggregateStat[];
  tagColor?: string;
  showHours?: boolean;
  darkMode?: boolean;
};

type TooltipPayloadEntry = {
  dataKey: string;
  color: string;
  value: number;
};

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
    <div className={`border rounded-xl p-3 text-sm min-w-[160px] ${darkMode ? "bg-gray-900 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)]" : "bg-white border-gray-200 shadow-lg"}`}>
      <p className={`font-semibold mb-1.5 truncate max-w-[200px] ${darkMode ? "text-gray-100" : "text-gray-900"}`}>
        {label}
      </p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex justify-between gap-4">
          <span style={{ color: entry.color }} className="font-medium">
            {entry.dataKey === "totalDials" ? "Dials" : "Call Hours"}
          </span>
          <span className={`font-mono ${darkMode ? "text-gray-200" : "text-gray-800"}`}>
            {entry.dataKey === "totalDials"
              ? entry.value.toLocaleString()
              : `${entry.value.toFixed(2)}h`}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function PhonebankerBarChart({
  data,
  tagColor = "#7c6cf0",
  showHours = true,
  darkMode = false,
}: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400 text-sm">
        No phonebanker data for this selection.
      </div>
    );
  }

  // Truncate long names for X axis
  const chartData = data.map((d) => ({
    ...d,
    shortName:
      d.phonebankerName.length > 16
        ? d.phonebankerName.slice(0, 14) + "…"
        : d.phonebankerName,
  }));

  return (
    <div className="w-full h-64 sm:h-[360px] min-w-0">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        margin={{ top: 10, right: 20, left: 0, bottom: 60 }}
        barCategoryGap="25%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#374151" : "#f0f0f0"} vertical={false} />

        <XAxis
          dataKey="shortName"
          tick={{ fontSize: 11, fill: darkMode ? "#9ca3af" : "#6b7280" }}
          angle={-40}
          textAnchor="end"
          interval="preserveStartEnd"
        />

        <YAxis
          yAxisId="dials"
          orientation="left"
          tick={{ fontSize: 11, fill: darkMode ? "#9ca3af" : "#6b7280" }}
          tickFormatter={(v: number) => v.toLocaleString()}
          width={55}
        />

        {showHours && (
          <YAxis
            yAxisId="hours"
            orientation="right"
            tick={{ fontSize: 11, fill: darkMode ? "#9ca3af" : "#6b7280" }}
            tickFormatter={(v: number) => `${v.toFixed(1)}h`}
            width={50}
          />
        )}

        <Tooltip content={<CustomTooltip darkMode={darkMode} />} cursor={{ fill: darkMode ? "#1f2937" : "#f5f3ff" }} />

        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value) =>
            value === "totalDials" ? "Dials" : "Call Hours"
          }
        />

        <Bar
          yAxisId="dials"
          dataKey="totalDials"
          name="totalDials"
          radius={[4, 4, 0, 0]}
          maxBarSize={40}
        >
          {chartData.map((_, i) => (
            <Cell
              key={i}
              fill={tagColor}
              fillOpacity={0.85 - i * 0.02 > 0.5 ? 0.85 - i * 0.02 : 0.5}
            />
          ))}
        </Bar>

        {showHours && (
          <Bar
            yAxisId="hours"
            dataKey="totalCallHours"
            name="totalCallHours"
            fill={darkMode ? "#45d399" : "#5de0ad"}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
