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
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 flex items-center gap-1 h-11">
        {LINKS.map((link) => {
          const isActive =
            link.href === "/pdi" ? pathname === "/pdi" : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={[
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
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
