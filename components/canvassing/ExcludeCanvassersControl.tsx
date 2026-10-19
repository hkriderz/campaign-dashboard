"use client";

export type ExcludeSectionOption = {
  id: string;
  label: string;
};

export default function ExcludeCanvassersControl({
  names,
  onNamesChange,
  sections,
  selected,
  onSelectedChange,
  help,
  matchNote,
  rows = 3,
  placeholder = "One name per line, e.g.\nJane Smith\nSmith, Jane",
}: {
  names: string;
  onNamesChange: (value: string) => void;
  sections: ExcludeSectionOption[];
  selected: Record<string, boolean>;
  onSelectedChange: (next: Record<string, boolean>) => void;
  help?: string;
  matchNote?: string;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div className="block">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Exclude canvassers</span>
      <textarea
        value={names}
        onChange={(event) => onNamesChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-white/10 dark:bg-gray-950 dark:text-gray-100"
      />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {sections.map((section) => (
          <label key={section.id} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={selected[section.id] === true}
              onChange={(event) =>
                onSelectedChange({
                  ...selected,
                  [section.id]: event.target.checked,
                })
              }
              className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
            {section.label}
          </label>
        ))}
      </div>
      {help || matchNote ? (
        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
          {help}
          {matchNote ? ` ${matchNote}` : ""}
        </span>
      ) : null}
    </div>
  );
}
