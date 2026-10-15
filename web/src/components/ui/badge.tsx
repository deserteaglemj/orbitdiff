import type { ReactNode } from "react";

import { cx } from "./classes";

export type BadgeTone = "ok" | "warning" | "danger" | "neutral" | "info";

const TONES: Record<BadgeTone, string> = {
  ok: "border-green/50 bg-green-tint text-green",
  warning: "border-amber/50 bg-amber-tint text-amber",
  // Danger is the only filled badge, so it differs from warning by shape as well as by wording.
  danger: "border-danger bg-danger font-semibold text-ground",
  neutral: "border-line bg-raised text-ink",
  info: "border-blue/50 bg-blue-tint text-blue",
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** The state in words. Required: a badge never carries meaning by colour alone. */
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
