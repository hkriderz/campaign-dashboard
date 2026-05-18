"use client";

import { useState, useMemo } from "react";
import type { PhoneBankCsvRow } from "@/lib/types";
import { sumRows, ssRate } from "@/lib/csv-parser";

// ─── Column group definitions ─────────────────────────────────────────────────

type ColKey = keyof PhoneBankCsvRow;

type ColDef = {
  key: ColKey;
  label: string;
  short: string;
  isTime?: boolean;
  highlight?: "green" | "red" | "blue" | "amber";
};

type ColGroup = {
  id: string;
  label: string;
  headerBg: string;
  headerText: string;
  cols: ColDef[];
};

const COL_GROUPS: ColGroup[] = [
  {
    id: "session",
    label: "Session",
    headerBg: "bg-slate-700",
    headerText: "text-white",
    cols: [
      { key: "hoursLoggedIn", label: "Hours In", short: "Hrs In", isTime: true },
      { key: "timeInCalls", label: "Call Time", short: "Call Time", isTime: true },
    ],
  },
  {
    id: "contact",
    label: "Contact Funnel",
    headerBg: "bg-sky-700",
    headerText: "text-white",
    cols: [
      { key: "callsAnswered", label: "Calls Answered", short: "Calls" },
      { key: "correctPerson", label: "Correct Person", short: "Crrct" },
      { key: "surveyed", label: "Surveyed", short: "Srvyd" },
      { key: "surveyRateRaw", label: "Survey %", short: "Svy%" },
    ],
  },
  {
    id: "polling",
    label: "Polling",
    headerBg: "bg-violet-700",
    headerText: "text-white",
    cols: [
      { key: "pollingFaizah", label: "Faizah", short: "Fzh" },
      { key: "pollingUndecidedB", label: "Undecided B", short: "UndB" },
      { key: "pollingUndecided", label: "Undecided", short: "Und" },
      { key: "pollingTraci", label: "Traci", short: "Traci" },
    ],
  },
  {
    id: "pitch",
    label: "Faizah Pitch",
    headerBg: "bg-indigo-700",
    headerText: "text-white",
    cols: [
      { key: "pitchSS", label: "Strong Support", short: "SS", highlight: "green" },
      { key: "pitchUndecidedB", label: "Undecided B", short: "UndB" },
      { key: "pitchUndecided", label: "Undecided", short: "Und" },
      { key: "pitchSO", label: "Strong Oppose", short: "SO", highlight: "red" },
      { key: "pitchHangUp", label: "Hang Up", short: "HU" },
    ],
  },
  {
    id: "ntp",
    label: "Not Traci Park",
    headerBg: "bg-teal-700",
    headerText: "text-white",
    cols: [
      { key: "ntpFaizah", label: "Faizah", short: "Fzh", highlight: "green" },
      { key: "ntpCommits", label: "Won't Vote Traci", short: "WVT" },
      { key: "ntpUndecided", label: "Undecided", short: "Und" },
      { key: "ntpTraciSupporter", label: "Traci Supporter", short: "Traci" },
      { key: "ntpHangUp", label: "Hang Up", short: "HU" },
    ],
  },
  {
    id: "final",
    label: "Final Result",
    headerBg: "bg-emerald-700",
    headerText: "text-white",
    cols: [
      { key: "finalSS", label: "Strong Support", short: "SS", highlight: "green" },
      { key: "finalWontVoteTraci", label: "Won't Vote Traci", short: "WVT" },
      { key: "finalUndecided", label: "Undecided", short: "Und" },
      { key: "finalSO", label: "Strong Oppose", short: "SO", highlight: "red" },
    ],
  },
  {
    id: "donate",
    label: "Donate",
    headerBg: "bg-amber-700",
    headerText: "text-white",
    cols: [
      { key: "donateNow", label: "Will Donate Now", short: "Now", highlight: "green" },
      { key: "donateLater", label: "Will Donate Later", short: "Later" },
      { key: "donateUndecided", label: "Undecided", short: "Und" },
      { key: "donateWont", label: "Will Not Donate", short: "No" },
    ],
  },
  {
    id: "disclaimer",
    label: "Disclaimer",
    headerBg: "bg-gray-600",
    headerText: "text-white",
    cols: [
      { key: "disclaimerNo", label: "No", short: "No" },
      { key: "disclaimerYes", label: "Yes", short: "Yes" },
    ],
  },
  {
    id: "canvass",
    label: "Canvass Non-Contact",
    headerBg: "bg-rose-700",
    headerText: "text-white",
    cols: [
      { key: "canvassAMNA", label: "AM / No Answer", short: "AMNA" },
      { key: "canvassCallBack", label: "Call Back", short: "CB" },
      { key: "canvassDeclined", label: "Declined", short: "Dec" },
      { key: "canvassDNC", label: "Do Not Call", short: "DNC" },
      { key: "canvassLangOther", label: "Lang: Other", short: "L:Oth" },
      { key: "canvassLangSpanish", label: "Lang: Spanish", short: "L:Esp" },
      { key: "canvassMoved", label: "Moved", short: "Moved" },
      { key: "canvassWrongNumber", label: "Wrong #", short: "WN" },
      { key: "canvassAnsweringMachine", label: "Answering Machine", short: "AnsM" },
      { key: "canvassVoicemail", label: "Voicemail", short: "VM" },
    ],
  },
  {
    id: "flyer",
    label: "Flyer",
    headerBg: "bg-orange-600",
    headerText: "text-white",
    cols: [
      { key: "flyerYes", label: "Yes", short: "Yes" },
      { key: "flyerUnsure", label: "Unsure", short: "?" },
      { key: "flyerNo", label: "No", short: "No" },
    ],
  },
  {
    id: "violations",
    label: "Traci Violations Rap",
    headerBg: "bg-pink-700",
    headerText: "text-white",
    cols: [
      { key: "violationsYes", label: "Should Disqualify", short: "Yes", highlight: "green" },
      { key: "violationsUnsure", label: "Unsure", short: "?" },
      { key: "violationsNo", label: "Should Not", short: "No" },
    ],
  },
  {
    id: "voteplan",
    label: "Vote Plan",
    headerBg: "bg-cyan-700",
    headerText: "text-white",
    cols: [
      { key: "votePlanA", label: "Filled Out Ballot on Phone", short: "A" },
      { key: "votePlanB", label: "Vote by Mail w/ Photo", short: "B" },
      { key: "votePlanC", label: "Early In Person w/ Photo", short: "C" },
      { key: "votePlanD", label: "Election Day w/ Photo", short: "D" },
      { key: "votePlanE", label: "Made Plan, No Photo", short: "E" },
      { key: "votePlanF", label: "No Plan", short: "F" },
      { key: "votePlanG", label: "Already Voted", short: "G" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCellValue(row: PhoneBankCsvRow, key: ColKey): string {
  const val = row[key];
  if (val === undefined || val === null || val === 0) return "—";
  return String(val);
}

function highlightClass(col: ColDef, val: string): string {
  if (val === "—" || val === "0") return "";
  if (col.highlight === "green") return "text-emerald-700 font-semibold";
  if (col.highlight === "red") return "text-rose-600 font-medium";
  return "";
}

function ssRateLabel(row: PhoneBankCsvRow): string {
  if (!row.surveyed) return "—";
  return `${((row.finalSS / row.surveyed) * 100).toFixed(1)}%`;
}

// ─── Row type styles ──────────────────────────────────────────────────────────

const ROW_STYLES = {
  total: "bg-gray-900 text-white font-bold text-xs sticky top-[4rem] z-10",
  subtotal: "bg-gray-700 text-white font-semibold text-xs",
  groupHeader: "bg-indigo-800 text-white font-bold text-xs cursor-pointer select-none",
  data: "bg-white hover:bg-indigo-50 text-xs text-gray-700",
  dataAlt: "bg-gray-50 hover:bg-indigo-50 text-xs text-gray-700",
};

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  rows: PhoneBankCsvRow[];
  campaignLabel: string;
};

export default function AggregateTable({ rows, campaignLabel }: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedColGroups, setCollapsedColGroups] = useState<Set<string>>(new Set());

  // Determine which column groups have any nonzero data (hide if all zero)
  const activeColGroups = useMemo(() => {
    return COL_GROUPS.filter((grp) => {
      if (["session", "contact", "final"].includes(grp.id)) return true;
      return grp.cols.some((col) =>
        rows.some((r) => {
          const v = r[col.key];
          return typeof v === "number" ? v > 0 : Boolean(v);
        })
      );
    });
  }, [rows]);

  // Group rows by phone bank
  const groups = useMemo(() => {
    const map = new Map<string, PhoneBankCsvRow[]>();
    for (const row of rows) {
      const key = row.phoneBankName || "Unknown";
      const existing = map.get(key) ?? [];
      existing.push(row);
      map.set(key, existing);
    }
    const result: Array<{ name: string; rows: PhoneBankCsvRow[]; subtotal: PhoneBankCsvRow }> = [];
    for (const [name, pbRows] of map) {
      result.push({
        name,
        rows: pbRows.sort((a, b) => a.date.localeCompare(b.date)),
        subtotal: sumRows(pbRows, { phoneBankName: name, callerName: "SUBTOTAL", date: "" }),
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const grandTotal = useMemo(
    () => sumRows(rows, { phoneBankName: campaignLabel, callerName: "TOTAL", date: "" }),
    [rows, campaignLabel]
  );

  function toggleGroup(name: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleColGroup(id: string) {
    setCollapsedColGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function collapseAll() {
    setCollapsedGroups(new Set(groups.map((g) => g.name)));
  }
  function expandAll() {
    setCollapsedGroups(new Set());
  }

  // Build the flat list of visible columns
  const visibleColGroups = activeColGroups.map((grp) => ({
    ...grp,
    collapsed: collapsedColGroups.has(grp.id),
    visibleCols: collapsedColGroups.has(grp.id) ? [] : grp.cols,
  }));

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex-wrap">
        <p className="text-xs text-gray-500">
          {rows.length} rows · {groups.length} phone bank{groups.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs text-gray-400 self-center">Phone Banks:</span>
          <button onClick={collapseAll} className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300 text-gray-700">
            Collapse All
          </button>
          <button onClick={expandAll} className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300 text-gray-700">
            Expand All
          </button>
        </div>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto relative">
        <table className="border-collapse min-w-max text-xs">
          <thead className="sticky top-0 z-20">
            {/* Column group header row */}
            <tr>
              {/* Fixed identity columns */}
              <th
                className="sticky left-0 z-30 bg-gray-800 text-white px-3 py-2 border border-gray-600 text-left min-w-[90px] whitespace-nowrap"
                rowSpan={2}
              >
                Date
              </th>
              <th
                className="sticky left-[90px] z-30 bg-gray-800 text-white px-3 py-2 border border-gray-600 text-left min-w-[180px] whitespace-nowrap"
                rowSpan={2}
              >
                Phone Bank
              </th>
              <th
                className="sticky left-[270px] z-30 bg-gray-800 text-white px-3 py-2 border border-gray-600 text-left min-w-[150px] whitespace-nowrap"
                rowSpan={2}
              >
                Caller Name
              </th>

              {/* Dynamic column groups */}
              {visibleColGroups.map((grp) => {
                const colSpan = grp.collapsed ? 1 : grp.cols.length;
                return (
                  <th
                    key={grp.id}
                    colSpan={colSpan}
                    onClick={() => toggleColGroup(grp.id)}
                    className={[
                      grp.headerBg,
                      grp.headerText,
                      "px-2 py-1.5 border border-gray-600 text-center cursor-pointer hover:opacity-90 select-none whitespace-nowrap",
                    ].join(" ")}
                    title={grp.collapsed ? "Click to expand" : "Click to collapse"}
                  >
                    <span className="flex items-center justify-center gap-1">
                      {grp.label}
                      <span className="opacity-70 text-[10px]">{grp.collapsed ? "▶" : "▾"}</span>
                    </span>
                  </th>
                );
              })}
            </tr>

            {/* Individual column headers */}
            <tr>
              {visibleColGroups.map((grp) => {
                if (grp.collapsed) {
                  return (
                    <th
                      key={`${grp.id}-collapsed`}
                      className={`${grp.headerBg} ${grp.headerText} px-2 py-1 border border-gray-600 text-center whitespace-nowrap opacity-80`}
                    >
                      Σ
                    </th>
                  );
                }
                return grp.cols.map((col) => (
                  <th
                    key={col.key}
                    className={`${grp.headerBg} ${grp.headerText} px-2 py-1 border border-gray-600 text-center whitespace-nowrap font-medium min-w-[52px]`}
                    title={col.label}
                  >
                    {col.short}
                  </th>
                ));
              })}
            </tr>
          </thead>

          <tbody>
            {/* Grand Total row */}
            <TotalRow
              row={grandTotal}
              label="GRAND TOTAL"
              visibleColGroups={visibleColGroups}
              className={ROW_STYLES.total}
              showDate={false}
              showPb
            />

            {/* Phone Bank groups */}
            {groups.map((grp, gi) => {
              const collapsed = collapsedGroups.has(grp.name);
              return (
                <>
                  {/* Group header / toggle row */}
                  <tr
                    key={`header-${grp.name}`}
                    onClick={() => toggleGroup(grp.name)}
                    className={ROW_STYLES.groupHeader}
                  >
                    <td className="sticky left-0 z-10 bg-indigo-800 px-3 py-2 border border-indigo-600 whitespace-nowrap" colSpan={1}>
                      {collapsed ? "▶" : "▼"}
                    </td>
                    <td className="sticky left-[90px] z-10 bg-indigo-800 px-3 py-2 border border-indigo-600 whitespace-nowrap" colSpan={1}>
                      {grp.name}
                    </td>
                    <td className="sticky left-[270px] z-10 bg-indigo-800 px-3 py-2 border border-indigo-600 whitespace-nowrap">
                      {grp.rows.length} caller{grp.rows.length !== 1 ? "s" : ""}
                    </td>
                    {/* Empty cells for data columns */}
                    {visibleColGroups.flatMap((vg) =>
                      vg.collapsed
                        ? [<td key={`${grp.name}-${vg.id}`} className="bg-indigo-800 border border-indigo-600 px-2 py-2" />]
                        : vg.cols.map((col) => (
                          <td key={`${grp.name}-${col.key}`} className="bg-indigo-800 border border-indigo-600 px-2 py-2" />
                        ))
                    )}
                  </tr>

                  {/* Data rows */}
                  {!collapsed &&
                    grp.rows.map((row, ri) => (
                      <DataRow
                        key={`row-${gi}-${ri}`}
                        row={row}
                        visibleColGroups={visibleColGroups}
                        className={ri % 2 === 0 ? ROW_STYLES.data : ROW_STYLES.dataAlt}
                      />
                    ))}

                  {/* Subtotal row */}
                  {!collapsed && (
                    <TotalRow
                      key={`sub-${grp.name}`}
                      row={grp.subtotal}
                      label={`${grp.name} — TOTAL`}
                      visibleColGroups={visibleColGroups}
                      className={ROW_STYLES.subtotal}
                      showDate={false}
                      showPb={false}
                    />
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type VcGroup = ColGroup & { collapsed: boolean; visibleCols: ColDef[] };

function DataRow({
  row,
  visibleColGroups,
  className,
}: {
  row: PhoneBankCsvRow;
  visibleColGroups: VcGroup[];
  className: string;
}) {
  return (
    <tr className={className}>
      <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 border border-gray-100 whitespace-nowrap">
        {row.date || "—"}
      </td>
      <td className="sticky left-[90px] z-10 bg-inherit px-3 py-1.5 border border-gray-100 whitespace-nowrap max-w-[180px] truncate">
        {row.phoneBankName || "—"}
      </td>
      <td className="sticky left-[270px] z-10 bg-inherit px-3 py-1.5 border border-gray-100 whitespace-nowrap">
        {row.callerName}
      </td>

      {visibleColGroups.flatMap((grp) => {
        if (grp.collapsed) {
          // Show the sum of the group when collapsed
          const colSum = grp.cols.reduce((sum, col) => {
            const v = row[col.key];
            return sum + (typeof v === "number" ? v : 0);
          }, 0);
          return [
            <td
              key={`${grp.id}-sum`}
              className="px-2 py-1.5 border border-gray-100 text-center text-gray-500 font-medium"
            >
              {colSum > 0 ? colSum : "—"}
            </td>,
          ];
        }
        return grp.cols.map((col) => {
          const raw = getCellValue(row, col.key);
          return (
            <td
              key={col.key}
              className={`px-2 py-1.5 border border-gray-100 text-center ${highlightClass(col, raw)}`}
            >
              {raw}
            </td>
          );
        });
      })}
    </tr>
  );
}

function TotalRow({
  row,
  label,
  visibleColGroups,
  className,
  showDate,
  showPb,
}: {
  row: PhoneBankCsvRow;
  label: string;
  visibleColGroups: VcGroup[];
  className: string;
  showDate: boolean;
  showPb: boolean;
}) {
  return (
    <tr className={className}>
      <td className="sticky left-0 z-10 bg-inherit px-3 py-2 border border-gray-600 whitespace-nowrap">
        {showDate ? row.date : ""}
      </td>
      <td className="sticky left-[90px] z-10 bg-inherit px-3 py-2 border border-gray-600 whitespace-nowrap">
        {showPb ? row.phoneBankName : label}
      </td>
      <td className="sticky left-[270px] z-10 bg-inherit px-3 py-2 border border-gray-600 whitespace-nowrap">
        {showPb ? label : row.callerName}
      </td>

      {visibleColGroups.flatMap((grp) => {
        if (grp.collapsed) {
          const colSum = grp.cols.reduce((sum, col) => {
            const v = row[col.key];
            return sum + (typeof v === "number" ? v : 0);
          }, 0);
          return [
            <td key={`${grp.id}-sum`} className="px-2 py-2 border border-gray-600 text-center">
              {colSum > 0 ? colSum : "—"}
            </td>,
          ];
        }
        return grp.cols.map((col) => {
          const raw = getCellValue(row, col.key);
          return (
            <td key={col.key} className="px-2 py-2 border border-gray-600 text-center">
              {raw}
            </td>
          );
        });
      })}
    </tr>
  );
}
