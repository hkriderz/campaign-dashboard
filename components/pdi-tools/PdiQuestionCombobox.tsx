"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import type { PdiQuestion } from "@/lib/pdi-tools/types";

interface Props {
  value: string;
  onChange: (id: string) => void;
  questions: PdiQuestion[];
  placeholder?: string;
}

export default function PdiQuestionCombobox({
  value,
  onChange,
  questions,
  placeholder = "Search or select PDI question…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedQuestion = useMemo(
    () => questions.find((q) => q.id === value),
    [questions, value]
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return questions;
    const q = search.toLowerCase();
    return questions.filter(
      (p) =>
        (p.question ?? "").toLowerCase().includes(q) ||
        (p.questionDescription ?? "").toLowerCase().includes(q) ||
        (p.candidate ?? "").toLowerCase().includes(q)
    );
  }, [search, questions]);

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
      setSearch("");
    },
    [onChange]
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    if (!open) setOpen(true);
  }

  function handleFocus() {
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
    }
  }

  const inputValue = open ? search : (selectedQuestion?.question ?? "");

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full text-[11px] px-2 py-1 pr-12 rounded border border-gray-200 dark:border-zinc-700/60 focus:outline-none focus:ring-1 focus:ring-green-500/40 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 placeholder-gray-400 dark:placeholder-zinc-600 transition-colors"
        />

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value ? (
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect("");
              }}
              className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 px-1 py-0.5 rounded text-[11px] leading-none transition-colors"
              aria-label="Clear selection"
              type="button"
            >
              ✕
            </button>
          ) : null}
          <span
            className={`text-gray-400 dark:text-zinc-600 text-[11px] transition-transform pointer-events-none ${
              open ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </div>
      </div>

      {open ? (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700/60 rounded shadow-xl max-h-60 overflow-y-auto">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              handleSelect("");
            }}
            type="button"
            className="w-full text-left px-3 py-1.5 text-[11px] text-gray-400 dark:text-zinc-600 hover:bg-gray-50 dark:hover:bg-zinc-700/50 border-b border-gray-100 dark:border-zinc-700/50 transition-colors"
          >
            — No mapping —
          </button>

          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-gray-400 dark:text-zinc-600 text-center">
              No PDI questions match &ldquo;{search}&rdquo;
            </div>
          ) : (
            filtered.map((q) => {
              const isSelected = q.id === value;
              return (
                <button
                  key={q.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(q.id);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    isSelected
                      ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                      : "text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700/50"
                  }`}
                >
                  <span className="font-medium">{q.question ?? "(unnamed)"}</span>
                  {q.candidate ? (
                    <span className="text-gray-400 dark:text-zinc-500 ml-1.5">· {q.candidate}</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
