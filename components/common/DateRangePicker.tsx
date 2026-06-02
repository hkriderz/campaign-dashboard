"use client";

import { useMemo, useState } from "react";
import { compareIsoDates, isValidIsoDate } from "@/lib/validation/iso-date";

type DateRangePickerProps = {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
  label?: string;
  helpText?: string;
  minDate?: string;
  maxDate?: string;
  allowEmpty?: boolean;
  tone?: "indigo" | "emerald" | "violet";
};

const toneClasses = {
  indigo: {
    active: "bg-indigo-600 text-white",
    range: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100",
    ring: "focus-visible:ring-indigo-400/60",
  },
  emerald: {
    active: "bg-emerald-600 text-white",
    range: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
    ring: "focus-visible:ring-emerald-400/60",
  },
  violet: {
    active: "bg-violet-600 text-white",
    range: "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-100",
    ring: "focus-visible:ring-violet-400/60",
  },
} as const;

function monthLabel(monthIso: string): string {
  const date = new Date(`${monthIso}-01T12:00:00`);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthStartIso(isoDate: string): string {
  const fallback = new Date();
  const [year, month] = isValidIsoDate(isoDate)
    ? isoDate.split("-").map(Number)
    : [fallback.getFullYear(), fallback.getMonth() + 1];
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(monthIso: string, delta: number): string {
  const [year, month] = monthIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysForMonth(monthIso: string): Array<string | null> {
  const [year, month] = monthIso.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = first.getUTCDay();
  const days: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function inRange(date: string, start: string, end: string): boolean {
  return compareIsoDates(date, start) >= 0 && compareIsoDates(date, end) <= 0;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onChange,
  label = "Date range",
  helpText,
  minDate,
  maxDate,
  allowEmpty = false,
  tone = "indigo",
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [monthIso, setMonthIso] = useState(() => monthStartIso(startDate || endDate));
  const [draftStart, setDraftStart] = useState(startDate);
  const [hoverDate, setHoverDate] = useState("");
  const toneClass = toneClasses[tone];

  const days = useMemo(() => daysForMonth(monthIso), [monthIso]);
  const validStart = isValidIsoDate(startDate) ? startDate : "";
  const validEnd = isValidIsoDate(endDate) ? endDate : validStart;
  const previewStart = draftStart || validStart;
  const previewEnd = draftStart && hoverDate
    ? compareIsoDates(hoverDate, draftStart) < 0
      ? draftStart
      : hoverDate
    : validEnd;
  const previewMin = previewStart && previewEnd && compareIsoDates(previewStart, previewEnd) <= 0 ? previewStart : previewEnd;
  const previewMax = previewStart && previewEnd && compareIsoDates(previewStart, previewEnd) <= 0 ? previewEnd : previewStart;

  function isDisabled(date: string): boolean {
    if (minDate && compareIsoDates(date, minDate) < 0) return true;
    if (maxDate && compareIsoDates(date, maxDate) > 0) return true;
    return false;
  }

  function chooseDate(date: string) {
    if (isDisabled(date)) return;
    if (!draftStart) {
      setDraftStart(date);
      onChange({ startDate: date, endDate: date });
      return;
    }

    const nextStart = compareIsoDates(date, draftStart) < 0 ? date : draftStart;
    const nextEnd = compareIsoDates(date, draftStart) < 0 ? draftStart : date;
    onChange({ startDate: nextStart, endDate: nextEnd });
    setDraftStart("");
    setHoverDate("");
    setOpen(false);
  }

  function updateInput(which: "start" | "end", value: string) {
    const nextStart = which === "start" ? value : startDate;
    const nextEnd = which === "end" ? value : endDate;
    if (allowEmpty && !nextStart && !nextEnd) {
      onChange({ startDate: "", endDate: "" });
      return;
    }
    onChange({ startDate: nextStart, endDate: nextEnd });
    if (isValidIsoDate(nextStart || nextEnd)) setMonthIso(monthStartIso(nextStart || nextEnd));
  }

  return (
    <div className="relative">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-200">{label} start</span>
          <input
            type="date"
            value={startDate}
            min={minDate}
            max={maxDate}
            onChange={(event) => updateInput("start", event.target.value)}
            onFocus={() => setOpen(true)}
            className={`mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-current focus:outline-none focus:ring-2 ${toneClass.ring} dark:border-white/10 dark:bg-gray-950 dark:text-gray-100`}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-200">{label} end</span>
          <input
            type="date"
            value={endDate}
            min={minDate}
            max={maxDate}
            onChange={(event) => updateInput("end", event.target.value)}
            onFocus={() => setOpen(true)}
            className={`mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-current focus:outline-none focus:ring-2 ${toneClass.ring} dark:border-white/10 dark:bg-gray-950 dark:text-gray-100`}
          />
        </label>
      </div>
      {helpText ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{helpText}</p> : null}

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMonthIso(shiftMonth(monthIso, -1))}
              className={`rounded-lg px-2 py-1 text-sm font-semibold text-gray-600 transition-all hover:bg-gray-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 ${toneClass.ring} dark:text-gray-300 dark:hover:bg-white/10`}
            >
              Prev
            </button>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{monthLabel(monthIso)}</p>
            <button
              type="button"
              onClick={() => setMonthIso(shiftMonth(monthIso, 1))}
              className={`rounded-lg px-2 py-1 text-sm font-semibold text-gray-600 transition-all hover:bg-gray-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 ${toneClass.ring} dark:text-gray-300 dark:hover:bg-white/10`}
            >
              Next
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-gray-400">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((date, index) => {
              if (!date) return <div key={`blank-${index}`} />;
              const selected = date === validStart || date === validEnd;
              const highlighted = previewMin && previewMax && inRange(date, previewMin, previewMax);
              const disabled = isDisabled(date);
              return (
                <button
                  key={date}
                  type="button"
                  disabled={disabled}
                  onMouseEnter={() => setHoverDate(date)}
                  onClick={() => chooseDate(date)}
                  className={[
                    "rounded-lg px-2 py-1.5 text-sm transition-all focus-visible:outline-none focus-visible:ring-2",
                    toneClass.ring,
                    selected ? toneClass.active : highlighted ? toneClass.range : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10",
                    disabled ? "cursor-not-allowed opacity-40" : "active:scale-[0.96]",
                  ].join(" ")}
                >
                  {Number(date.slice(-2))}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {allowEmpty ? (
              <button
                type="button"
                onClick={() => {
                  onChange({ startDate: "", endDate: "" });
                  setDraftStart("");
                  setOpen(false);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 transition-all hover:bg-gray-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 ${toneClass.ring} dark:text-gray-300 dark:hover:bg-white/10`}
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setDraftStart("");
                setOpen(false);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 transition-all hover:bg-gray-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 ${toneClass.ring} dark:text-gray-300 dark:hover:bg-white/10`}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
