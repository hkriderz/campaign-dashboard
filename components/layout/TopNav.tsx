"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WhaleMark from "@/components/brand/WhaleMark";
import ThemeToggle from "./ThemeToggle";

const MODES = [
  { href: "/phonebanking", label: "Phone Banking", icon: "📞" },
  { href: "/canvassing", label: "Canvassing", icon: "🚶" },
  { href: "/pdi", label: "PDI Tools", icon: "🔧" },
] as const;

export default function TopNav() {
  const pathname = usePathname();

  const activeMode =
    MODES.find((m) => pathname.startsWith(m.href))?.href ?? null;

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200/80 dark:border-white/10 bg-white/75 dark:bg-gray-950/80 backdrop-blur-xl">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 flex items-center justify-between h-[3.25rem]">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors"
        >
          <WhaleMark variant="plain" size="sm" alt="" />
          <span className="hidden sm:inline tracking-tight">Campaign Dashboard</span>
        </Link>

        <div className="flex items-center gap-3">
          <nav
            className="flex items-center gap-1 rounded-full border border-gray-200/80 dark:border-white/10 bg-gray-100/60 dark:bg-white/5 p-1"
            aria-label="Main navigation"
          >
            {MODES.map((mode) => {
              const isActive = activeMode === mode.href;
              return (
                <Link
                  key={mode.href}
                  href={mode.href}
                  className={[
                    "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-150",
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
