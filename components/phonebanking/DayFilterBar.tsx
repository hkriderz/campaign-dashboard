"use client";

type Props = {
  dates: string[];
  selectedDate: string | null;
  onChange: (date: string | null) => void;
};

export default function DayFilterBar({ dates, selectedDate, onChange }: Props) {
  if (!dates.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        Filter by day:
      </span>

      <button
        onClick={() => onChange(null)}
        className={[
          "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
          selectedDate === null
            ? "bg-indigo-600 text-white border-indigo-600"
            : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300",
        ].join(" ")}
      >
        All days
      </button>

      {dates.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={[
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            selectedDate === d
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300",
          ].join(" ")}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
