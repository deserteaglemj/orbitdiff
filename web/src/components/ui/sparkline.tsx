import { cx } from "./classes";
import { sparklineGeometry, sparklineSummary, type SparkPoint } from "./sparkline-geometry";

export interface SparklineProps {
  /** The series in order, oldest first. */
  points: SparkPoint[];
  width?: number;
  height?: number;
  /** Replaces the generated summary sentence. */
  summary?: string;
  /** Shows the summary under the drawing. It is always available to assistive technology. */
  showSummary?: boolean;
  className?: string;
}

/**
 * A small trend line drawn as plain SVG. The drawing is hidden from assistive technology and the
 * summary sentence carries the same information. With no points it renders the summary only.
 */
export function Sparkline({ points, width = 160, height = 48, summary, showSummary = false, className }: SparklineProps) {
  const geometry = sparklineGeometry(points, { width, height, padding: 5 });
  const text = summary ?? sparklineSummary(points);

  if (geometry.points.length === 0) {
    return <p className={cx("text-sm text-muted", className)}>{text}</p>;
  }

  const last = geometry.points[geometry.points.length - 1];
  return (
    <figure className={cx("m-0", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden="true"
        focusable="false"
        className="block max-w-full"
      >
        {geometry.points.length > 1 ? (
          <path
            d={geometry.path}
            fill="none"
            stroke="var(--color-blue)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        <circle cx={last.x} cy={last.y} r="3.5" fill="var(--color-amber)" />
      </svg>
      <figcaption className={showSummary ? "mt-2 text-xs text-muted" : "sr-only"}>{text}</figcaption>
    </figure>
  );
}
