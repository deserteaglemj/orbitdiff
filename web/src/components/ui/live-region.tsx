import type { ReactNode } from "react";

import { cx } from "./classes";

export interface LiveRegionProps {
  /** The latest result. Change the content to announce it; leave it empty between results. */
  children?: ReactNode;
  /** Interrupts the screen reader. Use only for failures that need action now. */
  assertive?: boolean;
  /** Announce without showing anything, when the result is already visible elsewhere. */
  visuallyHidden?: boolean;
  className?: string;
}

/**
 * Announces the outcome of an asynchronous action. Keep it mounted from the first render: a live
 * region that is inserted together with its text is not announced reliably.
 */
export function LiveRegion({ children, assertive = false, visuallyHidden = false, className }: LiveRegionProps) {
  return (
    <div
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
      className={cx(visuallyHidden ? "sr-only" : "min-h-6 text-sm text-ink", className)}
    >
      {children}
    </div>
  );
}
