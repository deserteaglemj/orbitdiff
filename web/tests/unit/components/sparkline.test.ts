import { describe, expect, it } from "vitest";

import { sparklineGeometry, sparklineSummary } from "@/components/ui/sparkline-geometry";

const series = [
  { label: "1 Sep", value: 100 },
  { label: "8 Sep", value: 99 },
  { label: "15 Sep", value: 103 },
];

describe("sparklineGeometry", () => {
  it("returns no points and an empty path for an empty series", () => {
    const g = sparklineGeometry([], { width: 100, height: 40, padding: 4 });
    expect(g.points).toEqual([]);
    expect(g.path).toBe("");
  });

  it("spreads points evenly between the horizontal padding", () => {
    const g = sparklineGeometry(series, { width: 100, height: 40, padding: 4 });
    expect(g.points.map((p) => p.x)).toEqual([4, 50, 96]);
  });

  it("puts the highest value at the top padding and the lowest at the bottom", () => {
    const g = sparklineGeometry(series, { width: 100, height: 40, padding: 4 });
    expect(g.points[2].y).toBe(4);
    expect(g.points[1].y).toBe(36);
    expect(g.points[0].y).toBe(28);
    expect(g.min).toBe(99);
    expect(g.max).toBe(103);
  });

  it("draws a flat series on the vertical centre", () => {
    const g = sparklineGeometry(
      [
        { label: "a", value: 7 },
        { label: "b", value: 7 },
      ],
      { width: 100, height: 40, padding: 4 },
    );
    expect(g.points.map((p) => p.y)).toEqual([20, 20]);
  });

  it("centres a single point", () => {
    const g = sparklineGeometry([{ label: "a", value: 5 }], { width: 100, height: 40, padding: 4 });
    expect(g.points).toEqual([{ x: 50, y: 20, label: "a", value: 5 }]);
    expect(g.path).toBe("M50 20");
  });

  it("builds a move-then-line path through every point", () => {
    const g = sparklineGeometry(series, { width: 100, height: 40, padding: 4 });
    expect(g.path).toBe("M4 28 L50 36 L96 4");
  });

  it("ignores values that are not finite numbers", () => {
    const g = sparklineGeometry(
      [
        { label: "a", value: 1 },
        { label: "b", value: Number.NaN },
        { label: "c", value: 3 },
      ],
      { width: 100, height: 40, padding: 4 },
    );
    expect(g.points.map((p) => p.label)).toEqual(["a", "c"]);
  });

  it("rounds coordinates to two decimals", () => {
    const g = sparklineGeometry(
      [
        { label: "a", value: 0 },
        { label: "b", value: 1 },
        { label: "c", value: 3 },
        { label: "d", value: 2 },
      ],
      { width: 100, height: 40, padding: 4 },
    );
    expect(g.points[1]).toMatchObject({ x: 34.67, y: 25.33 });
  });
});

describe("sparklineSummary", () => {
  it("says when there is nothing to show", () => {
    expect(sparklineSummary([])).toBe("No data points.");
  });

  it("describes a single point", () => {
    expect(sparklineSummary([{ label: "1 Sep", value: 1284 }])).toBe("1 data point: 1,284 at 1 Sep.");
  });

  it("describes the range, the ends, and the extremes of a series", () => {
    expect(sparklineSummary(series)).toBe(
      "3 data points from 1 Sep to 15 Sep. First 100, last 103, lowest 99, highest 103.",
    );
  });
});
