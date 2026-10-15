import { cx } from "./classes";

export interface SpinnerProps {
  /** What is loading. Announced to assistive technology, and shown when `showLabel` is set. */
  label?: string;
  showLabel?: boolean;
  /** Set when a parent already announces the loading state (for example a busy button). */
  decorative?: boolean;
  className?: string;
}

/** An indeterminate progress ring. It stops turning when reduced motion is requested. */
export function Spinner({ label = "Loading", showLabel = false, decorative = false, className }: SpinnerProps) {
  const ring = (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
  if (decorative) {
    return <span className={cx("inline-flex", className)}>{ring}</span>;
  }
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 text-sm text-muted", className)}>
      {ring}
      <span className={showLabel ? undefined : "sr-only"}>{label}</span>
    </span>
  );
}
