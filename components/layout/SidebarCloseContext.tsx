"use client";

import { createContext, useContext } from "react";

export const SidebarCloseContext = createContext<(() => void) | null>(null);

export function useSidebarClose(): (() => void) | null {
  return useContext(SidebarCloseContext);
}
