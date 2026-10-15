"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useTransition, type ReactNode } from "react";

/**
 * Lets a form ask the server to render the page again after it saved
 * something, so everything the server renders (the usage, the next review
 * times, the name in the header) shows the stored state. What was typed into a
 * form stays, because a refresh keeps client state.
 *
 * Outside the provider the request does nothing. That is the case when a
 * screen is rendered without the app router, as the markup tests do.
 */
export interface RouteRefresh {
  /** Ask the server to render the current page again. */
  refresh: () => void;
  /** True while that render is on its way. */
  refreshing: boolean;
}

const RefreshContext = createContext<RouteRefresh>({ refresh: () => undefined, refreshing: false });

export function useRouteRefresh(): RouteRefresh {
  return useContext(RefreshContext);
}

/** Rendered by the settings page around the screen. */
export function RouteRefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const value = useMemo<RouteRefresh>(
    () => ({ refresh: () => startTransition(() => router.refresh()), refreshing }),
    [router, refreshing],
  );
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}
