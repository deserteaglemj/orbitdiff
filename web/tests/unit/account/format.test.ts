import { describe, expect, it } from "vitest";

import { formatBytes, formatDateTime, quotaState } from "@/components/settings/format";

const KB = 1024;
const MB = 1024 * 1024;

describe("formatBytes", () => {
  it("writes small sizes in bytes, with the singular for one", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(1023)).toBe("1,023 bytes");
  });

  it("uses KB, MB, and GB with 1,024 as the step, as the Terms do for the storage quota", () => {
    expect(formatBytes(KB)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(MB)).toBe("1 MB");
    expect(formatBytes(20 * MB)).toBe("20 MB");
    expect(formatBytes(400 * MB)).toBe("400 MB");
    expect(formatBytes(1024 * MB)).toBe("1 GB");
    expect(formatBytes(1536 * MB)).toBe("1.5 GB");
  });

  it("keeps at most one decimal place", () => {
    expect(formatBytes(1234 * KB)).toBe("1.2 MB");
    expect(formatBytes(12.34 * MB)).toBe("12.3 MB");
  });

  it("moves to the next unit when rounding would print 1,024 of the smaller one", () => {
    expect(formatBytes(MB - 1)).toBe("1 MB");
    expect(formatBytes(1024 * MB - 1)).toBe("1 GB");
  });

  it("does not invent a unit above GB", () => {
    expect(formatBytes(4096 * 1024 * MB)).toBe("4,096 GB");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["negative", -1],
  ])("renders Unknown, never zero, for a size that is %s", (_label, value) => {
    expect(formatBytes(value)).toBe("Unknown");
  });
});

describe("formatDateTime", () => {
  it("shows the date and the 24 hour time in the given timezone and names the timezone", () => {
    expect(formatDateTime("2026-09-30T12:05:00.000Z", "Europe/Berlin")).toBe("30 Sep 2026, 14:05 (Europe/Berlin)");
    expect(formatDateTime("2026-09-30T12:05:00.000Z", "America/Chicago")).toBe("30 Sep 2026, 07:05 (America/Chicago)");
  });

  it("uses UTC when no timezone is given", () => {
    expect(formatDateTime("2026-09-30T12:05:00.000Z")).toBe("30 Sep 2026, 12:05 (UTC)");
  });

  it("moves the date when the timezone is on another calendar day", () => {
    expect(formatDateTime("2026-09-30T23:30:00Z", "Asia/Tokyo")).toBe("1 Oct 2026, 08:30 (Asia/Tokyo)");
  });

  it("writes midnight as 00:00", () => {
    expect(formatDateTime("2026-10-01T00:00:00Z", "UTC")).toBe("1 Oct 2026, 00:00 (UTC)");
  });

  it("falls back to UTC, and says so, for a timezone the runtime does not know", () => {
    expect(formatDateTime("2026-09-30T12:05:00Z", "Mars/Olympus")).toBe("30 Sep 2026, 12:05 (UTC)");
  });

  it("renders Unknown for a missing or unreadable time", () => {
    expect(formatDateTime(null)).toBe("Unknown");
    expect(formatDateTime(undefined, "UTC")).toBe("Unknown");
    expect(formatDateTime("", "UTC")).toBe("Unknown");
    expect(formatDateTime("not a time", "UTC")).toBe("Unknown");
  });
});

describe("quotaState", () => {
  it("is within the limit below 80 percent", () => {
    expect(quotaState(1, 3)).toEqual({
      level: "ok",
      label: "Within the limit",
      tone: "ok",
      used: 1,
      limit: 3,
      remaining: 2,
    });
    expect(quotaState(0, 10).level).toBe("ok");
    expect(quotaState(7, 10).level).toBe("ok");
  });

  it("is near the limit from 80 percent", () => {
    expect(quotaState(8, 10)).toMatchObject({ level: "near", label: "Near the limit", tone: "info", remaining: 2 });
    expect(quotaState(9, 10).level).toBe("near");
  });

  it("is reached at the limit and above it, with nothing remaining", () => {
    expect(quotaState(3, 3)).toMatchObject({ level: "reached", label: "Limit reached", tone: "warning", remaining: 0 });
    expect(quotaState(12, 10)).toMatchObject({ level: "reached", remaining: 0 });
  });

  it("treats a limit of zero or less as reached, so nothing is offered that the server would refuse", () => {
    expect(quotaState(0, 0).level).toBe("reached");
    expect(quotaState(0, -5).level).toBe("reached");
  });

  it.each([
    ["not a number", Number.NaN, 10],
    ["negative", -1, 10],
    ["infinite", Number.POSITIVE_INFINITY, 10],
    ["measured against a limit that is not a number", 1, Number.NaN],
  ])("is unknown, never within the limit, when the usage is %s", (_label, used, limit) => {
    expect(quotaState(used, limit)).toMatchObject({ level: "unknown", label: "Unknown", tone: "neutral", remaining: null });
  });
});
