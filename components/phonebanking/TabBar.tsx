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
    <div className="flex gap-1 border-b border-[var(--section-rule)] mb-6 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              "flex items-center gap-1.5 px-3 sm:px-4 py-2.5 min-h-11 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex-shrink-0",
              isActive
                ? "border-[var(--section-accent)] text-[var(--section-ink)]"
                : "border-transparent text-[var(--section-muted)] hover:text-[var(--section-ink)] hover:border-[var(--section-rule)]",
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
