import type { ReactNode } from "react";

import { cx } from "./classes";
import { formatCount, UNKNOWN } from "./format";

export interface StatTileProps {
  label: ReactNode;
  /**
   * A number is formatted with thousands separators. `null` means the evidence does not support a
   * value and renders the word "Unknown". It never renders as zero.
   */
  value: number | string | null;
  /** One short line under the value, for example the coverage the count depends on. */
  hint?: ReactNode;
  /** Use "ground" when the tile sits inside a Card, so it stays distinct from the card. */
  tone?: "surface" | "ground";
  className?: string;
}

export function StatTile({ label, value, hint, tone = "surface", className }: StatTileProps) {
  const known = value !== null && !(typeof value === "number" && !Number.isFinite(value));
  const text = typeof value === "number" ? formatCount(value) : (value ?? UNKNOWN);
  return (
    <div
      className={cx(
        "min-w-0 rounded-xl border border-line p-4",
        tone === "ground" ? "bg-ground" : "bg-surface",
        className,
      )}
    >
      <p className="text-sm text-muted">{label}</p>
      <p
        className={cx(
          "mt-1 text-2xl leading-8 font-semibold tabular-nums",
          known ? "text-ink" : "font-normal text-muted",
        )}
      >
        {text}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Lays StatTile elements out two across. With `columns={4}` (the default) it is four across from 1024px. */
export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 4;
  className?: string;
}) {
  return <div className={cx("grid grid-cols-2 gap-3", columns === 4 && "lg:grid-cols-4", className)}>{children}</div>;
}
