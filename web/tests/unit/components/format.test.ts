import { describe, expect, it } from "vitest";

import { cx, describedBy, isExternalHref } from "@/components/ui/classes";
import { formatCount, formatDate, observedBetween, UNKNOWN } from "@/components/ui/format";

describe("cx", () => {
  it("joins truthy class names with one space", () => {
    expect(cx("a", false, undefined, null, "", "b c")).toBe("a b c");
  });
});

describe("describedBy", () => {
  it("joins the ids that are present", () => {
    expect(describedBy("f-hint", false, "f-error")).toBe("f-hint f-error");
  });

  it("returns undefined when there is nothing to reference", () => {
    expect(describedBy(undefined, false, null)).toBeUndefined();
  });
});

describe("isExternalHref", () => {
  it("is true for absolute http and https addresses and for mail links", () => {
    expect(isExternalHref("https://github.com/deserteaglemj/orbitdiff")).toBe(true);
    expect(isExternalHref("http://example.com")).toBe(true);
    expect(isExternalHref("mailto:someone@example.com")).toBe(true);
  });

  it("is false for paths and fragments inside the app", () => {
    expect(isExternalHref("/sign-up")).toBe(false);
    expect(isExternalHref("#cannot-do")).toBe(false);
    expect(isExternalHref("/legal/privacy#retention")).toBe(false);
  });
});

describe("formatCount", () => {
  it("renders Unknown for a missing value, never zero", () => {
    expect(formatCount(null)).toBe(UNKNOWN);
    expect(formatCount(undefined)).toBe(UNKNOWN);
    expect(UNKNOWN).toBe("Unknown");
  });

  it("renders zero as zero", () => {
    expect(formatCount(0)).toBe("0");
  });

  it("groups thousands", () => {
    expect(formatCount(50000)).toBe("50,000");
  });

  it("renders Unknown for a value that is not a finite number", () => {
    expect(formatCount(Number.NaN)).toBe(UNKNOWN);
  });
});

describe("formatDate", () => {
  it("renders day, short month, and year in UTC by default", () => {
    expect(formatDate("2026-09-01T12:00:00+00:00")).toBe("1 Sep 2026");
  });

  it("uses the given timezone", () => {
    expect(formatDate("2026-09-01T02:00:00+00:00", "America/New_York")).toBe("31 Aug 2026");
  });

  it("renders Unknown for a missing or unreadable value", () => {
    expect(formatDate(null)).toBe(UNKNOWN);
    expect(formatDate("not a date")).toBe(UNKNOWN);
  });

  it("falls back to UTC for a timezone the runtime does not know", () => {
    expect(formatDate("2026-09-01T12:00:00+00:00", "Nowhere/Invalid")).toBe("1 Sep 2026");
  });
});

describe("observedBetween", () => {
  it("words an export difference as an observation between two capture dates", () => {
    expect(observedBetween("2026-09-01T12:00:00+00:00", "2026-09-08T12:00:00+00:00")).toBe(
      "observed in your export between 1 Sep 2026 and 8 Sep 2026",
    );
  });
});
