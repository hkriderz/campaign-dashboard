"use client";

import { useState, useMemo } from "react";
import type { PhoneBankCsvRow } from "@/lib/types";
import { sumRows, ssRate, parseTimeToSec, secToTime } from "@/lib/csv-parser";
import { canonicalizePhonebankerName } from "@/lib/phonebanker-name";

// ─── Column definitions ───────────────────────────────────────────────────────

type ColDef = {
  key: string;
  label: string;
  short: string;
  getValue: (row: AggRow) => string | number;
  sortKey?: (row: AggRow) => number;
  highlight?: "green" | "red";
};

type AggRow = {
  callerName: string;
  phoneBanks: string[];
  sessionCount: number;
  hoursLoggedIn: string;
  timeInCalls: string;
  summedRow: PhoneBankCsvRow;
};

const DEFAULT_OTHER_POSITIVE_LABEL = "Other Positive (Won't Vote Opponent)";

function buildColumns(otherPositiveLabel: string): ColDef[] {
  return [
  {
    key: "callerName",
    label: "Caller Name",
    short: "Name",
    getValue: (r) => r.callerName,
    sortKey: (r) => 0,
  },
  {
    key: "phoneBanks",
    label: "Phone Banks",
    short: "# PBs",
    getValue: (r) => r.phoneBanks.length,
    sortKey: (r) => r.phoneBanks.length,
  },
  {
    key: "sessions",
    label: "Sessions/Days",
    short: "Sess.",
    getValue: (r) => r.sessionCount,
    sortKey: (r) => r.sessionCount,
  },
  {
    key: "hoursLoggedIn",
    label: "Hours Logged In",
    short: "Hrs In",
    getValue: (r) => r.hoursLoggedIn,
    sortKey: (r) => parseTimeToSec(r.hoursLoggedIn),
  },
  {
    key: "timeInCalls",
    label: "Call Time",
    short: "Call Time",
    getValue: (r) => r.timeInCalls,
    sortKey: (r) => parseTimeToSec(r.timeInCalls),
  },
  {
    key: "callsAnswered",
    label: "Calls Made",
    short: "Calls",
    getValue: (r) => r.summedRow.callsAnswered,
    sortKey: (r) => r.summedRow.callsAnswered,
  },
  {
    key: "correctPerson",
    label: "Connects (Correct Person)",
    short: "Connect",
    getValue: (r) => r.summedRow.correctPerson,
    sortKey: (r) => r.summedRow.correctPerson,
  },
  {
    key: "declines",
    label: "Declines / Hangups",
    short: "Decline",
    getValue: (r) =>
      r.summedRow.canvassDeclined + r.summedRow.pitchHangUp + r.summedRow.ntpHangUp,
    sortKey: (r) =>
      r.summedRow.canvassDeclined + r.summedRow.pitchHangUp + r.summedRow.ntpHangUp,
    highlight: "red",
  },
  {
    key: "surveyed",
    label: "Surveyed",
    short: "Srvyd",
    getValue: (r) => r.summedRow.surveyed,
    sortKey: (r) => r.summedRow.surveyed,
  },
  {
    key: "finalSS",
    label: "Strong Supports",
    short: "SS",
    getValue: (r) => r.summedRow.finalSS,
    sortKey: (r) => r.summedRow.finalSS,
    highlight: "green",
  },
  {
    key: "finalWontVoteTraci",
    label: otherPositiveLabel,
    short: "Other+",
    getValue: (r) => r.summedRow.finalWontVoteTraci,
    sortKey: (r) => r.summedRow.finalWontVoteTraci,
  },
  {
    key: "finalUndecided",
    label: "Undecided",
    short: "Und",
    getValue: (r) => r.summedRow.finalUndecided,
    sortKey: (r) => r.summedRow.finalUndecided,
  },
  {
    key: "finalSO",
    label: "Oppose",
    short: "SO",
    getValue: (r) => r.summedRow.finalSO,
    sortKey: (r) => r.summedRow.finalSO,
    highlight: "red",
  },
  {
    key: "connectRate",
    label: "Connect Rate",
    short: "Conn%",
    getValue: (r) =>
      r.summedRow.callsAnswered
        ? `${((r.summedRow.correctPerson / r.summedRow.callsAnswered) * 100).toFixed(1)}%`
        : "—",
    sortKey: (r) =>
      r.summedRow.callsAnswered ? (r.summedRow.correctPerson / r.summedRow.callsAnswered) * 100 : 0,
  },
  {
    key: "ssRate",
    label: "Strong Support Rate",
    short: "SS%",
    getValue: (r) => ssRate(r.summedRow),
    sortKey: (r) =>
      r.summedRow.surveyed ? (r.summedRow.finalSS / r.summedRow.surveyed) * 100 : 0,
    highlight: "green",
  },
];
}

function formatAggregateCell(col: ColDef, val: string | number): string {
  if (col.key === "callerName" || col.key === "hoursLoggedIn" || col.key === "timeInCalls") {
    return String(val);
  }
  if (col.key === "connectRate" || col.key === "ssRate") {
    return String(val);
  }
  if (typeof val === "number" && Number.isFinite(val)) {
    return val.toLocaleString();
  }
  return String(val);
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  rows: PhoneBankCsvRow[];
  /** Label for the merged “other / won’t vote opponent” outcome column (per script profile). */
  otherPositiveColumnLabel?: string;
  /** Stable left-to-right order for wide-import extra columns (per tag). */
  extraWideColumnOrder?: string[];
};

export default function PhonebankerAggregateTable({
  rows,
  otherPositiveColumnLabel = DEFAULT_OTHER_POSITIVE_LABEL,
  extraWideColumnOrder,
}: Props) {
  const [sortBy, setSortBy] = useState<string>("finalSS");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterName, setFilterName] = useState("");

  const columns = useMemo(() => {
    const base = buildColumns(otherPositiveColumnLabel);
    const order = extraWideColumnOrder ?? [];
    const seen = new Set(order);
    const fromRows = [...new Set(rows.flatMap((r) => Object.keys(r.extraWideColumns ?? {})))].filter(
      (h) => !seen.has(h)
    );
    fromRows.sort((a, b) => a.localeCompare(b));
    const allExtra = [...order.map((h) => h.trim()).filter(Boolean)];
    for (const h of fromRows) {
      if (!allExtra.includes(h)) allExtra.push(h);
    }
    const extras: ColDef[] = allExtra
      .filter((header) => rows.some((r) => (r.extraWideColumns?.[header] ?? 0) !== 0))
      .map((header) => ({
        key: `ew:${header}`,
        label: header,
        short: header.length > 10 ? `${header.slice(0, 9)}…` : header,
        getValue: (r: AggRow) => r.summedRow.extraWideColumns?.[header] ?? 0,
        sortKey: (r: AggRow) => Number(r.summedRow.extraWideColumns?.[header] ?? 0),
      }));
    return [...base, ...extras];
  }, [otherPositiveColumnLabel, rows, extraWideColumnOrder]);

  // Aggregate rows per caller name
  const aggregated = useMemo<AggRow[]>(() => {
    const map = new Map<string, PhoneBankCsvRow[]>();
    for (const row of rows) {
      const key = canonicalizePhonebankerName(row.callerName);
      const existing = map.get(key) ?? [];
      existing.push({
        ...row,
        callerName: key,
      });
      map.set(key, existing);
    }

    const result: AggRow[] = [];
    for (const [callerName, callerRows] of map) {
      const phoneBanks = [...new Set(callerRows.map((r) => r.phoneBankName).filter(Boolean))];
      const sessionCount = new Set(
        callerRows.map((r) => `${r.date}::${r.phoneBankName}`)
      ).size;

      const totalLoggedSec = callerRows.reduce(
        (s, r) => s + parseTimeToSec(r.hoursLoggedIn), 0
      );
      const totalCallSec = callerRows.reduce(
        (s, r) => s + parseTimeToSec(r.timeInCalls), 0
      );

      const summedRow = sumRows(callerRows, { callerName, date: "", phoneBankName: "" });

      result.push({
        callerName,
        phoneBanks,
        sessionCount,
        hoursLoggedIn: secToTime(totalLoggedSec),
        timeInCalls: secToTime(totalCallSec),
        summedRow,
      });
    }
    return result;
  }, [rows]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortBy);
    const filtered = filterName
      ? aggregated.filter((r) =>
          r.callerName.toLowerCase().includes(filterName.toLowerCase())
        )
      : aggregated;

    return [...filtered].sort((a, b) => {
      const aVal = col?.sortKey ? col.sortKey(a) : a.callerName;
      const bVal = col?.sortKey ? col.sortKey(b) : b.callerName;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "desc" ? bVal - aVal : aVal - bVal;
      }
      return sortDir === "desc"
        ? String(bVal).localeCompare(String(aVal))
        : String(aVal).localeCompare(String(bVal));
    });
  }, [aggregated, sortBy, sortDir, filterName, columns]);

  function handleSort(key: string) {
    if (key === sortBy) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  }

  // Grand total row for the footer
  const totalRow = useMemo(
    () =>
      sumRows(rows, {
        callerName: "TOTAL",
        phoneBankName: "",
        date: "",
      }),
    [rows]
  );

  const totalAgg: AggRow = {
    callerName: "TOTAL",
    phoneBanks: [...new Set(rows.map((r) => r.phoneBankName))],
    sessionCount: new Set(rows.map((r) => `${r.date}::${r.phoneBankName}`)).size,
    hoursLoggedIn: secToTime(rows.reduce((s, r) => s + parseTimeToSec(r.hoursLoggedIn), 0)),
    timeInCalls: secToTime(rows.reduce((s, r) => s + parseTimeToSec(r.timeInCalls), 0)),
    summedRow: totalRow,
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm bg-white dark:bg-gray-900">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-wrap">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {aggregated.length} callers · {rows.length} total sessions
        </p>
        <input
          type="text"
          placeholder="Filter by name…"
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-700 dark:text-gray-100 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 w-44"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="border-collapse w-full text-xs min-w-max">
          <thead className="sticky top-0 z-10 bg-gray-800 text-white">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3 py-2.5 border border-gray-600 text-left cursor-pointer hover:bg-gray-700 whitespace-nowrap select-none"
                  title={col.label}
                >
                  <span className="flex items-center gap-1">
                    {col.short}
                    {sortBy === col.key && (
                      <span className="text-indigo-300">{sortDir === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-gray-900 text-white font-bold">
              {columns.map((col) => {
                if (col.key === "phoneBanks") {
                  return (
                    <td key={col.key} className="px-3 py-2.5 border border-gray-700 text-center">
                      {totalAgg.phoneBanks.length}
                    </td>
                  );
                }
                const val = col.getValue(totalAgg);
                return (
                  <td
                    key={col.key}
                    className={`px-3 py-2.5 border border-gray-700 ${col.key === "callerName" ? "" : "text-center"}`}
                  >
                    {formatAggregateCell(col, val)}
                  </td>
                );
              })}
            </tr>
            {sorted.map((row, i) => (
              <tr
                key={row.callerName}
                className={
                  i % 2 === 0
                    ? "bg-white dark:bg-gray-900 hover:bg-indigo-50 dark:hover:bg-gray-800"
                    : "bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-gray-800"
                }
              >
                {columns.map((col) => {
                  const val = col.getValue(row);
                  const numericHighlight =
                    typeof val === "number" && Number.isFinite(val) && val > 0;
                  const cellClass = [
                    "px-3 py-2 border border-gray-100 whitespace-nowrap",
                    "dark:border-gray-700",
                    col.key === "callerName" ? "font-medium text-gray-900 dark:text-gray-100" : "text-center",
                    col.highlight === "green" && numericHighlight ? "text-emerald-700 font-semibold" : "",
                    col.highlight === "red" && numericHighlight ? "text-rose-600" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  // Phone bank list: show as comma-separated
                  if (col.key === "phoneBanks") {
                    return (
                      <td key={col.key} className="px-3 py-2 border border-gray-100 dark:border-gray-700 text-center text-gray-500 dark:text-gray-400">
                        <span title={row.phoneBanks.join(", ")} className="cursor-help">
                          {row.phoneBanks.length}
                        </span>
                      </td>
                    );
                  }

                  return (
                    <td key={col.key} className={cellClass}>
                      {formatAggregateCell(col, val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
