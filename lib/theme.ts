/** Shared light/dark theme key (localStorage + cookie). */
export const THEME_STORAGE_KEY = "campaign-dashboard-theme";

export type ThemeMode = "light" | "dark";

/** Matches the pre-hydration script default when nothing is stored yet. */
export const DEFAULT_THEME: ThemeMode = "dark";

export function parseThemeMode(value: string | null | undefined): ThemeMode | null {
  if (value === "light" || value === "dark") return value;
  return null;
}

/** `document.cookie` assignment for client-side theme persistence (SSR on next request). */
export function writeThemeCookie(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_STORAGE_KEY}=${theme}; path=/; max-age=${maxAge}; samesite=lax`;
}

/**
 * Runs before React hydrates: apply theme class and sync localStorage → cookie so the
 * server can render the same `dark` class on the next navigation.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var s=localStorage.getItem(k);var d;if(s==="dark")d=true;else if(s==="light")d=false;else d=${DEFAULT_THEME === "dark"};var r=document.documentElement;if(d)r.classList.add("dark");else r.classList.remove("dark");document.cookie=k+"="+(d?"dark":"light")+";path=/;max-age=31536000;samesite=lax"}catch(e){}})();`;
