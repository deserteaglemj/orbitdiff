import type { ReactNode } from "react";

import { cx } from "./classes";

/** One placeholder block. Size it with classes to match the content it stands in for. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-pulse rounded-md bg-raised", className)} />;
}

export interface SkeletonProps {
  /** What is loading. Announced to assistive technology. */
  label?: string;
  /** Number of text-line placeholders when no children are given. */
  lines?: number;
  /** Custom placeholder layout built from SkeletonBlock. */
  children?: ReactNode;
  className?: string;
}

/**
 * A loading placeholder with an accessible label. Give it the same height as the loaded content
 * so nothing moves when the content arrives.
 */
export function Skeleton({ label = "Loading", lines = 3, children, className }: SkeletonProps) {
  return (
    <div role="status" aria-busy="true" className={cx("grid gap-3", className)}>
      <span className="sr-only">{label}</span>
      {children ??
        Array.from({ length: lines }, (_, index) => (
          <SkeletonBlock key={index} className={cx("h-4", index === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
    </div>
  );
}
