"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/pdi", label: "Overview" },
  { href: "/pdi/mapper", label: "Mapper" },
  { href: "/pdi/syncer", label: "Syncer" },
  { href: "/pdi/text-syncer", label: "Text Syncer" },
] as const;

export default function PdiSubNav() {
  const pathname = usePathname();

  return (
    <div className="border-b border-[var(--section-rule)] bg-[var(--section-paper)]">
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-6 flex items-center gap-0 h-auto min-h-11 py-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LINKS.map((link) => {
          const isActive =
            link.href === "/pdi" ? pathname === "/pdi" : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={[
                "relative px-3 py-2 min-h-10 inline-flex items-center text-sm whitespace-nowrap flex-shrink-0 transition-colors",
                isActive
                  ? "font-semibold text-[var(--section-ink)] after:absolute after:left-3 after:right-3 after:bottom-0 after:h-px after:bg-[var(--section-accent)]"
                  : "text-[var(--section-muted)] hover:text-[var(--section-ink)]",
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
