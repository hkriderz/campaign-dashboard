"use client";

import { useCallback, useEffect, useState } from "react";
import TopNav from "@/components/layout/TopNav";
import { SidebarCloseContext } from "@/components/layout/SidebarCloseContext";

type Props = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Phone banking / canvassing shell: fixed sidebar on lg+, slide-over drawer on smaller screens.
 */
export default function AppShell({ sidebar, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSidebar();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen, closeSidebar]);

  return (
    <SidebarCloseContext.Provider value={closeSidebar}>
      <div className="min-h-screen flex flex-col">
        <TopNav onOpenSidebar={() => setSidebarOpen(true)} showSidebarToggle />
        <div className="flex flex-1 min-h-0">
          <div className="hidden lg:block flex-shrink-0">{sidebar}</div>
          {sidebarOpen ? (
            <>
              <button
                type="button"
                aria-label="Close navigation menu"
                className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                onClick={closeSidebar}
              />
              <div className="fixed inset-y-0 left-0 z-50 w-[min(18rem,88vw)] max-h-[100dvh] overflow-y-auto lg:hidden shadow-xl">
                {sidebar}
              </div>
            </>
          ) : null}
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 bg-gray-50/50 dark:bg-gray-950">
            {children}
          </main>
        </div>
      </div>
    </SidebarCloseContext.Provider>
  );
}
