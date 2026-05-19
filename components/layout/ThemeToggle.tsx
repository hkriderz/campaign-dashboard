"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY, type ThemeMode, writeThemeCookie } from "@/lib/theme";

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

function readThemeFromDom(): ThemeMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function ThemeToggle() {
  /** `null` until mounted so server and first client paint match (avoids hydration mismatch). */
  const [theme, setTheme] = useState<ThemeMode | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const parsed =
      stored === "dark" || stored === "light" ? stored : readThemeFromDom();
    setTheme(parsed);
    applyTheme(parsed);
    writeThemeCookie(parsed);
  }, []);

  function toggle() {
    const current = theme ?? readThemeFromDom();
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    writeThemeCookie(next);
  }

  return (
    <button
      onClick={toggle}
      className="min-h-11 min-w-11 px-3 py-2 rounded-full text-xs font-semibold border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 bg-white/80 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors inline-flex items-center justify-center"
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      type="button"
    >
      {theme === null ? "Theme" : theme === "dark" ? "☀ Light" : "🌙 Night"}
    </button>
  );
}
