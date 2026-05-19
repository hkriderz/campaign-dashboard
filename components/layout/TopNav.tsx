"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WhaleMark from "@/components/brand/WhaleMark";
import ThemeToggle from "./ThemeToggle";

const MODES = [
  { href: "/phonebanking", label: "Phone Banking", shortLabel: "Phone", icon: "📞" },
  { href: "/canvassing", label: "Canvassing", shortLabel: "Canvas", icon: "🚶" },
  { href: "/pdi", label: "PDI Tools", shortLabel: "PDI", icon: "🔧" },
] as const;

type Props = {
  showSidebarToggle?: boolean;
  onOpenSidebar?: () => void;
};

export default function TopNav({ showSidebarToggle = false, onOpenSidebar }: Props) {
  const pathname = usePathname();

  const activeMode =
    MODES.find((m) => pathname.startsWith(m.href))?.href ?? null;

  const showMenu =
    showSidebarToggle &&
    (pathname.startsWith("/phonebanking") || pathname.startsWith("/canvassing"));

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200/80 dark:border-white/10 bg-white/75 dark:bg-gray-950/80 backdrop-blur-xl">
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 flex items-center justify-between gap-2 min-h-[3.25rem] h-auto py-2 sm:py-0 sm:h-[3.25rem]">
        <div className="flex items-center gap-2 min-w-0">
          {showMenu ? (
            <button
              type="button"
              onClick={onOpenSidebar}
              className="lg:hidden flex items-center justify-center min-h-11 min-w-11 rounded-xl border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10"
              aria-label="Open navigation menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          ) : null}
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors min-w-0"
          >
            <WhaleMark variant="plain" size="sm" alt="" />
            <span className="hidden sm:inline tracking-tight truncate">Campaign Dashboard</span>
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <nav
            className="flex items-center gap-0.5 sm:gap-1 rounded-full border border-gray-200/80 dark:border-white/10 bg-gray-100/60 dark:bg-white/5 p-0.5 sm:p-1 overflow-x-auto max-w-[52vw] sm:max-w-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Main navigation"
          >
            {MODES.map((mode) => {
              const isActive = activeMode === mode.href;
              return (
                <Link
                  key={mode.href}
                  href={mode.href}
                  className={[
                    "flex items-center gap-1 px-2.5 sm:px-3.5 py-2 sm:py-1.5 min-h-10 sm:min-h-9 rounded-full text-xs sm:text-sm font-medium transition-all duration-150 whitespace-nowrap flex-shrink-0",
                    isActive
                      ? "bg-indigo-600 text-white shadow-[0_0_18px_rgba(124,108,240,0.45)]"
                      : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/10",
                  ].join(" ")}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    {mode.icon}
                  </span>
                  <span className="hidden md:inline">{mode.label}</span>
                  <span className="md:hidden">{mode.shortLabel}</span>
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
