"use client";

import dynamic from "next/dynamic";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GAP_HISTOGRAM_BUCKETS, type GapHistogramBucket } from "@/lib/canvassing/non-contact-patterns/types";

const ChartShell = dynamic(() => Promise.resolve(({ children }: { children: React.ReactNode }) => <>{children}</>), {
  ssr: false,
});

type HistogramPoint = {
  bucket: string;
  teamPct: number;
  canvasserPct: number;
  currentPct: number;
};

type TrendPoint = {
  reportDate: string;
  rapidNonContactFlagCount: number;
  flaggedCanvasserCount: number;
  reportId?: string;
};

type RateBarPoint = {
  name: string;
  shortName: string;
  ratePct: number;
};

type Props = {
  teamHistogramPct: Record<GapHistogramBucket, number>;
  canvasserHistogramPct: Record<GapHistogramBucket, number> | null;
  currentHistogramPct: Record<GapHistogramBucket, number>;
  trend: TrendPoint[];
  topRates: RateBarPoint[];
  p25Rate?: number | null;
  p75Rate?: number | null;
  banner?: string | null;
  historyAsOf?: string | null;
  historyLookbackDays?: number;
  onTrendClick?: (reportId: string) => void;
  selectedCanvasserName?: string | null;
};

function pct(histogram: Record<GapHistogramBucket, number>, bucket: GapHistogramBucket): number {
  return Number(((histogram[bucket] ?? 0) * 100).toFixed(1));
}

function toHistogramPoints(
  team: Record<GapHistogramBucket, number>,
  canvasser: Record<GapHistogramBucket, number> | null,
  current: Record<GapHistogramBucket, number>
): HistogramPoint[] {
  return GAP_HISTOGRAM_BUCKETS.map((bucket) => ({
    bucket: `${bucket}s`,
    teamPct: pct(team, bucket),
    canvasserPct: canvasser ? pct(canvasser, bucket) : 0,
    currentPct: pct(current, bucket),
  }));
}

export default function NonContactBaselineCharts({
  teamHistogramPct,
  canvasserHistogramPct,
  currentHistogramPct,
  trend,
  topRates,
  p25Rate,
  p75Rate,
  banner,
  historyAsOf,
  historyLookbackDays = 21,
  onTrendClick,
  selectedCanvasserName,
}: Props) {
  const histData = toHistogramPoints(teamHistogramPct, canvasserHistogramPct, currentHistogramPct);
  const emptyHistoryMessage = historyAsOf
    ? `No saved reports in the ${historyLookbackDays}-day window before ${historyAsOf}. Open a later report day, or save more daily exports.`
    : `No saved reports in the last ${historyLookbackDays} days. Save daily exports to build history.`;

  return (
    <ChartShell>
      <div className="space-y-6">
        {banner ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {banner}
          </div>
        ) : null}

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">
            Gap histogram (non-contact → different household)
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Share of gaps by duration. Fraud clusters tend to pile into 0–15s; legitimate walks peak around 90–150s.
            {selectedCanvasserName ? ` Selected: ${selectedCanvasserName}.` : ""}
          </p>
          <div className="mt-4 h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" width={40} />
                <Tooltip formatter={(value: number) => `${value}%`} />
                <Legend />
                <ReferenceLine x="5-15s" stroke="#f59e0b" strokeDasharray="4 4" />
                <Bar dataKey="teamPct" name="Team baseline" fill="#9ca3af" radius={[3, 3, 0, 0]} />
                <Bar dataKey="currentPct" name="Current file" fill="#6366f1" radius={[3, 3, 0, 0]} />
                {canvasserHistogramPct ? (
                  <Bar dataKey="canvasserPct" name="Selected canvasser" fill="#dc2626" radius={[3, 3, 0, 0]} />
                ) : null}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">Daily trend</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Team rapid non-contact flags and flagged canvasser counts across saved report days.
          </p>
          <div className="mt-4 h-64 w-full min-w-0">
            {trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={trend}
                  margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  onClick={(state) => {
                    const id = (state?.activePayload?.[0]?.payload as TrendPoint | undefined)?.reportId;
                    if (id && onTrendClick) onTrendClick(id);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="reportDate" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={40} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="rapidNonContactFlagCount"
                    name="Rapid flags"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="flaggedCanvasserCount"
                    name="Flagged canvassers"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center px-4 text-center text-sm text-gray-500">
                {emptyHistoryMessage}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">
            Top canvassers by rapid non-contact rate
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Current file rates (sufficient sample only). Band marks team P25–P75 when available.
          </p>
          <div className="mt-4 h-72 w-full min-w-0">
            {topRates.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topRates} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="shortName" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => `${value}%`} labelFormatter={(_, payload) => payload?.[0]?.payload?.name ?? ""} />
                  {typeof p25Rate === "number" ? (
                    <ReferenceLine x={Number((p25Rate * 100).toFixed(1))} stroke="#94a3b8" strokeDasharray="3 3" />
                  ) : null}
                  {typeof p75Rate === "number" ? (
                    <ReferenceLine x={Number((p75Rate * 100).toFixed(1))} stroke="#94a3b8" strokeDasharray="3 3" />
                  ) : null}
                  <Bar dataKey="ratePct" name="Rapid rate %" fill="#ea580c" radius={[0, 3, 3, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-gray-500">
                No canvassers with sufficient sample for rate chart.
              </p>
            )}
          </div>
        </div>
      </div>
    </ChartShell>
  );
}
