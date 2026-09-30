"use client";

import { useSyncExternalStore } from "react";

import { isValidTimezone } from "@/domain/schedule";

const subscribe = () => () => undefined;

function readBrowserTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * The timezone of this browser, or null on the server and when the browser
 * reports none. Read through useSyncExternalStore so the server render and the
 * first client render agree, and the detected zone appears right after.
 */
export function useBrowserTimezone(): string | null {
  return useSyncExternalStore(subscribe, readBrowserTimezone, () => null);
}
