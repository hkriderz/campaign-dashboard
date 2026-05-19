"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { useSidebarClose } from "@/components/layout/SidebarCloseContext";
import type { CampaignTag } from "@/lib/types";

type SidebarProps = {
  tags: CampaignTag[];
  basePath: string; // e.g. "/phonebanking"
};

function navLinkClass(isActive: boolean) {
  return [
    "flex items-center gap-2.5 px-3 py-2.5 min-h-11 rounded-xl text-sm font-medium transition-all duration-150",
    isActive
      ? "dash-nav-active"
      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/5 hover:text-gray-800 dark:hover:text-gray-100 border border-transparent",
  ].join(" ");
}

export default function Sidebar({ tags, basePath }: SidebarProps) {
  const pathname = usePathname();
  const closeSidebar = useSidebarClose();

  function onNavClick() {
    closeSidebar?.();
  }

  return (
    <aside className="w-full lg:w-56 flex-shrink-0 border-r border-gray-200/80 dark:border-white/10 bg-white/80 dark:bg-gray-950/90 backdrop-blur-xl min-h-full py-5 px-2.5">
      <nav className="space-y-1">
        <div className="space-y-1 pb-4 mb-4 border-b border-gray-100 dark:border-white/10">
          <Link
            href={`${basePath}#all-campaigns`}
            onClick={onNavClick}
            className={navLinkClass(pathname === basePath)}
          >
            <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 flex-shrink-0" />
            All Campaigns
          </Link>
          {basePath === "/phonebanking" ? (
            <Link
              href="/phonebanking/campaign-tags"
              onClick={onNavClick}
              className={navLinkClass(pathname === "/phonebanking/campaign-tags")}
            >
              <span className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0" />
              Campaign tags
            </Link>
          ) : null}
          {basePath === "/phonebanking" ? (
            <Link
              href="/phonebanking/csv-upload"
              onClick={onNavClick}
              className={navLinkClass(
                pathname === "/phonebanking/csv-upload" ||
                  pathname.startsWith("/phonebanking/csv-upload")
              )}
            >
              <span className="w-2 h-2 rounded-full bg-mint-500 flex-shrink-0 shadow-[0_0_8px_rgba(69,211,153,0.6)]" />
              CSV upload
            </Link>
          ) : null}
        </div>

        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
          Candidates
        </p>
        {tags.map((tag, i) => {
          const href = `${basePath}/${tag.id}`;
          const isActive = pathname.startsWith(href);
          const showGroupHeader =
            Boolean(tag.navGroup) && tags[i - 1]?.navGroup !== tag.navGroup;
          return (
            <Fragment key={tag.id}>
              {showGroupHeader ? (
                <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500 first:pt-0">
                  {tag.navGroup}
                </p>
              ) : null}
              <Link
                href={href}
                onClick={onNavClick}
                className={[
                  navLinkClass(isActive),
                  tag.navGroup ? "pl-7 pr-3" : "",
                ].join(" ")}
                aria-current={isActive ? "page" : undefined}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white/10"
                  style={{ backgroundColor: tag.color }}
                  aria-hidden="true"
                />
                {tag.label}
              </Link>
            </Fragment>
          );
        })}
      </nav>
    </aside>
  );
}
