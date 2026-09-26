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
    "flex items-center gap-2.5 px-3 py-2.5 min-h-11 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--section-accent)]",
    isActive
      ? "dash-nav-active"
      : "text-[var(--section-muted)] hover:text-[var(--section-ink)] border border-transparent border-l-2 border-l-transparent",
  ].join(" ");
}

export default function Sidebar({ tags, basePath }: SidebarProps) {
  const pathname = usePathname();
  const closeSidebar = useSidebarClose();

  function onNavClick() {
    closeSidebar?.();
  }

  return (
    <aside className="w-full lg:w-56 flex-shrink-0 border-r border-[var(--section-rule)] bg-[var(--section-paper)] min-h-full py-5 px-2.5">
      <nav className="space-y-0.5">
        <div className="space-y-0.5 pb-4 mb-4 border-b border-[var(--section-rule)]">
          {basePath === "/canvassing" ? (
            <>
              <p className="section-kicker px-3 mb-2">
                Canvassing tools
              </p>
              <Link
                href="/canvassing/overview"
                onClick={onNavClick}
                className={navLinkClass(pathname === "/canvassing/overview" || pathname.startsWith("/canvassing/overview/"))}
              >
                <span className="w-1.5 h-1.5 rounded-none bg-sky-600 dark:bg-sky-400 flex-shrink-0" />
                Unique IDs
              </Link>
              <Link
                href="/canvassing/canvassers"
                onClick={onNavClick}
                className={navLinkClass(pathname.startsWith("/canvassing/canvassers"))}
              >
                <span className="w-1.5 h-1.5 rounded-none bg-teal-700 dark:bg-teal-400 flex-shrink-0" />
                Canvasser Overview
              </Link>
              <Link
                href="/canvassing"
                onClick={onNavClick}
                className={navLinkClass(pathname === "/canvassing")}
              >
                <span className="w-1.5 h-1.5 rounded-none bg-orange-700 dark:bg-orange-400 flex-shrink-0" />
                Knock Analysis
              </Link>
              <Link
                href="/canvassing/doorknocks-results"
                onClick={onNavClick}
                className={navLinkClass(pathname.startsWith("/canvassing/doorknocks-results"))}
              >
                <span className="w-1.5 h-1.5 rounded-none bg-emerald-800 dark:bg-lime-400 flex-shrink-0" />
                Doorknocks and Results
              </Link>
              <Link
                href="/canvassing/non-contact-patterns"
                onClick={onNavClick}
                className={navLinkClass(pathname.startsWith("/canvassing/non-contact-patterns"))}
              >
                <span className="w-1.5 h-1.5 rounded-none bg-amber-600 dark:bg-amber-400 flex-shrink-0" />
                Non-Contact Patterns
              </Link>
            </>
          ) : (
            <Link
              href={`${basePath}#all-campaigns`}
              onClick={onNavClick}
              className={navLinkClass(pathname === basePath)}
            >
              <span className="w-1.5 h-1.5 rounded-none bg-[var(--section-muted)] flex-shrink-0" />
              All Campaigns
            </Link>
          )}
          {basePath === "/phonebanking" || basePath === "/texting" ? (
            <Link
              href="/phonebanking/campaign-tags"
              onClick={onNavClick}
              className={navLinkClass(pathname === "/phonebanking/campaign-tags")}
            >
              <span className="w-1.5 h-1.5 rounded-none bg-[var(--section-muted)] flex-shrink-0" />
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
              <span className="w-1.5 h-1.5 rounded-none bg-mint-600 dark:bg-mint-400 flex-shrink-0" />
              CSV upload
            </Link>
          ) : null}
        </div>

        {basePath !== "/canvassing" && tags.length ? (
          <>
            <p className="section-kicker px-3 mb-2">
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
                    <p className="section-kicker px-3 pt-3 pb-1 first:pt-0">
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
                      className="w-2 h-2 rounded-none flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden="true"
                    />
                    {tag.label}
                  </Link>
                </Fragment>
              );
            })}
          </>
        ) : null}
      </nav>
    </aside>
  );
}
