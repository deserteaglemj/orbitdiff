import { formatCount } from "./format";

export interface SparkPoint {
  label: string;
  value: number;
}

export interface SparkOptions {
  width?: number;
  height?: number;
  padding?: number;
}

export interface PlottedPoint extends SparkPoint {
  x: number;
  y: number;
}

export interface SparkGeometry {
  width: number;
  height: number;
  points: PlottedPoint[];
  /** SVG path data through every point, or an empty string when there are none. */
  path: string;
  min: number;
  max: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

const finite = (points: SparkPoint[]) => points.filter((p) => Number.isFinite(p.value));

/**
 * Places a series inside a `width` by `height` box. Points are spread evenly left to right, the
 * highest value sits on the top padding and the lowest on the bottom padding. A flat series and a
 * single point sit on the centre.
 */
export function sparklineGeometry(points: SparkPoint[], options: SparkOptions = {}): SparkGeometry {
  const { width = 160, height = 48, padding = 4 } = options;
  const series = finite(points);
  if (series.length === 0) {
    return { width, height, points: [], path: "", min: 0, max: 0 };
  }

  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const plotted = series.map((point, index) => {
    const x = series.length === 1 ? width / 2 : padding + (innerWidth * index) / (series.length - 1);
    const y = max === min ? height / 2 : padding + innerHeight * (1 - (point.value - min) / (max - min));
    return { ...point, x: round(x), y: round(y) };
  });

  const path = plotted.map((p, index) => `${index === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return { width, height, points: plotted, path, min, max };
}

/** A sentence that carries the same information as the drawing, for people who cannot see it. */
export function sparklineSummary(points: SparkPoint[]): string {
  const series = finite(points);
  if (series.length === 0) {
    return "No data points.";
  }
  const first = series[0];
  if (series.length === 1) {
    return `1 data point: ${formatCount(first.value)} at ${first.label}.`;
  }
  const last = series[series.length - 1];
  const values = series.map((p) => p.value);
  return (
    `${series.length} data points from ${first.label} to ${last.label}. ` +
    `First ${formatCount(first.value)}, last ${formatCount(last.value)}, ` +
    `lowest ${formatCount(Math.min(...values))}, highest ${formatCount(Math.max(...values))}.`
  );
}
