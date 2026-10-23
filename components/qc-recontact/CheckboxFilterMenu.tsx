"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  addMembersToActorGroup,
  createActorGroup,
  deleteActorGroup,
  loadActorGroups,
  saveActorGroups,
  type ActorGroup,
  type ActorGroupRole,
} from "@/lib/qc-recontact/actor-groups";
import { listedSelection, type PeopleFilterMode } from "@/lib/qc-recontact/project-people-filter";

export function useActorGroups(role: ActorGroupRole): {
  groups: ActorGroup[];
  setGroups: (next: ActorGroup[]) => void;
} {
  const [groups, setGroupsState] = useState<ActorGroup[]>([]);
  useEffect(() => {
    setGroupsState(loadActorGroups(role));
  }, [role]);
  const setGroups = useCallback(
    (next: ActorGroup[]) => {
      setGroupsState(next);
      saveActorGroups(role, next);
    },
    [role]
  );
  return { groups, setGroups };
}

type Props = {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onSelectedChange: (next: string[]) => void;
  mode?: PeopleFilterMode;
  onModeChange?: (mode: PeopleFilterMode) => void;
  groups?: readonly ActorGroup[];
  onGroupsChange?: (next: ActorGroup[]) => void;
};

function buttonClass(active: boolean): string {
  return [
    "rounded-lg border px-2.5 py-1 text-xs font-medium",
    active
      ? "border-indigo-400 bg-indigo-50 text-indigo-800 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200"
      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200",
  ].join(" ");
}

export default function CheckboxFilterMenu({
  label,
  options,
  selected,
  onSelectedChange,
  mode,
  onModeChange,
  groups,
  onGroupsChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groupName, setGroupName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const displayOptions = useMemo(() => {
    const known = new Set(options);
    const extras = selected.filter((name) => !known.has(name));
    return [...extras, ...options];
  }, [options, selected]);

  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return displayOptions;
    return displayOptions.filter((option) => option.toLowerCase().includes(needle));
  }, [displayOptions, query]);

  const summary =
    selected.length === 0
      ? label
      : `${label} · ${mode === "exclude" ? "exclude " : ""}${selected.length}`;

  function toggle(option: string, on: boolean) {
    onSelectedChange(on ? [...selected, option] : selected.filter((item) => item !== option));
  }

  function createGroup() {
    if (!onGroupsChange) return;
    const id = `g-${Date.now().toString(36)}`;
    const next = createActorGroup(groups ?? [], groupName, selected, id);
    if (next === groups || next.length === (groups ?? []).length) return;
    onGroupsChange(next);
    setGroupName("");
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={buttonClass(open || selected.length > 0)}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {summary}
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute left-0 z-30 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-600 dark:bg-gray-900"
          role="group"
          aria-label={label}
        >
          {onModeChange ? (
            <div className="mb-2 flex gap-1">
              {(["include", "exclude"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={buttonClass(mode === choice)}
                  aria-pressed={mode === choice}
                  onClick={() => onModeChange(choice)}
                >
                  {choice === "include" ? "Include" : "Exclude"}
                </button>
              ))}
            </div>
          ) : null}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="mb-2 w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
          />
          <ul className="max-h-52 space-y-0.5 overflow-y-auto text-xs">
            {listed.length === 0 ? (
              <li className="px-1.5 py-1 text-gray-500 dark:text-gray-400">Nothing in this date range.</li>
            ) : (
              listed.map((option) => (
                <li key={option}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(option)}
                      onChange={(event) => toggle(option, event.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="min-w-0 break-words">{option}</span>
                  </label>
                </li>
              ))
            )}
          </ul>
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" className={buttonClass(false)} onClick={() => onSelectedChange(listedSelection(selected, listed, "all"))}>
              Select all
            </button>
            <button type="button" className={buttonClass(false)} onClick={() => onSelectedChange(listedSelection(selected, listed, "none"))}>
              Deselect all
            </button>
            <button type="button" className={buttonClass(false)} onClick={() => onSelectedChange(listedSelection(selected, listed, "invert"))}>
              Select unselected
            </button>
          </div>
          {onGroupsChange ? (
            <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-700">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Groups
              </p>
              <ul className="mb-2 max-h-28 space-y-1 overflow-y-auto text-xs">
                {(groups ?? []).length === 0 ? (
                  <li className="text-gray-500 dark:text-gray-400">No saved groups yet.</li>
                ) : (
                  (groups ?? []).map((group) => (
                    <li key={group.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={() => onSelectedChange(group.members)}
                        title={`Select ${group.members.length} people`}
                      >
                        {group.name}{" "}
                        <span className="tabular-nums text-gray-500">({group.members.length})</span>
                      </button>
                      <button
                        type="button"
                        className={buttonClass(false)}
                        onClick={() => onGroupsChange(addMembersToActorGroup(groups ?? [], group.id, selected))}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        className={buttonClass(false)}
                        onClick={() => onGroupsChange(deleteActorGroup(groups ?? [], group.id))}
                      >
                        Delete
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="New group name"
                  className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
                />
                <button type="button" className={buttonClass(false)} onClick={createGroup}>
                  Create
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
