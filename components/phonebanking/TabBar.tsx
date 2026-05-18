"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type TabDef = {
  id: string;
  label: string;
  icon?: string;
};

type Props = {
  tabs: TabDef[];
  paramKey?: string;
  defaultTab?: string;
};

export default function TabBar({ tabs, paramKey = "tab", defaultTab }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(paramKey) ?? defaultTab ?? tabs[0]?.id;

  return (
    <div className="flex gap-1 border-b border-gray-200/80 dark:border-white/10 mb-6">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        const params = new URLSearchParams(searchParams.toString());
        params.set(paramKey, tab.id);
        const href = `${pathname}?${params.toString()}`;

        return (
          <Link
            key={tab.id}
            href={href}
            className={[
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-300 shadow-[0_4px_12px_-4px_rgba(124,108,240,0.5)]"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600",
            ].join(" ")}
            aria-current={isActive ? "page" : undefined}
          >
            {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
