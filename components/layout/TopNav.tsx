"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WhaleMark from "@/components/brand/WhaleMark";
import ThemeToggle from "./ThemeToggle";

const MODES = [
  { href: "/phonebanking", label: "Phone Banking", shortLabel: "Phone" },
  { href: "/texting", label: "Texting", shortLabel: "Text" },
  { href: "/canvassing", label: "Canvassing", shortLabel: "Canvas" },
  { href: "/district-classifier", label: "Districts", shortLabel: "Districts" },
  { href: "/pdi", label: "PDI Tools", shortLabel: "PDI" },
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
    (pathname.startsWith("/phonebanking") ||
      pathname.startsWith("/texting") ||
      pathname.startsWith("/canvassing"));

  return (
    <header
      className="sticky top-0 z-40 border-b border-[var(--section-rule)] bg-[var(--section-paper)]"
      style={{ minHeight: "var(--app-header-height)" }}
    >
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 flex items-center justify-between gap-2 min-h-[3.25rem] h-auto py-2 sm:py-0 sm:h-[3.25rem]">
        <div className="flex items-center gap-2 min-w-0">
          {showMenu ? (
            <button
              type="button"
              onClick={onOpenSidebar}
              className="lg:hidden flex items-center justify-center min-h-11 min-w-11 border border-[var(--section-rule)] text-[var(--section-ink)] hover:bg-[color-mix(in_srgb,var(--section-accent)_8%,transparent)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)] transition-all"
              aria-label="Open navigation menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          ) : null}
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-[var(--section-ink)] hover:text-[var(--section-accent)] transition-colors min-w-0"
          >
            <WhaleMark variant="plain" size="sm" alt="" />
            <span className="hidden sm:inline font-display tracking-tight truncate">Campaign Dashboard</span>
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <nav
            className="flex items-center gap-0 sm:gap-1 overflow-x-auto max-w-[52vw] sm:max-w-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Main navigation"
          >
            {MODES.map((mode) => {
              const isActive = activeMode === mode.href;
              return (
                <Link
                  key={mode.href}
                  href={mode.href}
                  className={[
                    "relative px-2.5 sm:px-3 py-2 min-h-10 sm:min-h-9 text-xs sm:text-sm whitespace-nowrap flex-shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]",
                    isActive
                      ? "font-semibold text-[var(--section-ink)] after:absolute after:left-2 after:right-2 after:bottom-0 after:h-px after:bg-[var(--section-accent)]"
                      : "text-[var(--section-muted)] hover:text-[var(--section-ink)]",
                  ].join(" ")}
                  aria-current={isActive ? "page" : undefined}
                >
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
