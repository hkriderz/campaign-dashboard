"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/pdi", label: "Overview" },
  { href: "/pdi/mapper", label: "Mapper" },
  { href: "/pdi/syncer", label: "Syncer" },
] as const;

export default function PdiSubNav() {
  const pathname = usePathname();

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/50">
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 flex items-center gap-1 h-auto min-h-11 py-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LINKS.map((link) => {
          const isActive =
            link.href === "/pdi" ? pathname === "/pdi" : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={[
                "px-3 py-2 min-h-10 inline-flex items-center rounded-md text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0",
                isActive
                  ? "bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-400 shadow-sm border border-gray-200 dark:border-gray-700"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200",
              ].join(" ")}
              aria-current={isActive ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
