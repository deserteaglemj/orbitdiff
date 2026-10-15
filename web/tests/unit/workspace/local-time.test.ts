import { describe, expect, it } from "vitest";

import {
  formatLocalDateTime,
  formatLocalTime,
  localInputToIso,
  zoneLabel,
} from "@/components/dashboard/local-time";
import { parseCaptureTime } from "@/domain/capture-time";

const NOW = new Date("2026-09-30T12:00:00Z");

describe("formatLocalTime", () => {
  it("shows the date and the 24 hour time in the given timezone and names the timezone", () => {
    expect(formatLocalTime("2026-09-20T17:00:00+00:00", "America/Chicago")).toBe(
      "20 Sep 2026, 12:00 (America/Chicago)",
    );
    expect(formatLocalTime("2026-09-20T17:00:00+00:00", "Europe/Berlin")).toBe("20 Sep 2026, 19:00 (Europe/Berlin)");
  });

  it("moves the date when the timezone is on another calendar day", () => {
    expect(formatLocalTime("2026-09-20T23:30:00Z", "Asia/Tokyo")).toBe("21 Sep 2026, 08:30 (Asia/Tokyo)");
  });

  it("writes midnight as 00:00", () => {
    expect(formatLocalTime("2026-09-21T00:00:00Z", "UTC")).toBe("21 Sep 2026, 00:00 (UTC)");
  });

  it("falls back to UTC, and says so, when the timezone is not a name the runtime knows", () => {
    expect(formatLocalTime("2026-09-20T17:00:00Z", "Mars/Olympus")).toBe("20 Sep 2026, 17:00 (UTC)");
  });

  it("renders Unknown for a missing or unreadable time", () => {
    expect(formatLocalTime(null, "UTC")).toBe("Unknown");
    expect(formatLocalTime(undefined, "UTC")).toBe("Unknown");
    expect(formatLocalTime("not a time", "UTC")).toBe("Unknown");
  });
});

describe("formatLocalDateTime", () => {
  it("is the same reading without the timezone name", () => {
    expect(formatLocalDateTime("2026-09-20T17:00:00Z", "America/Chicago")).toBe("20 Sep 2026, 12:00");
  });
});

describe("zoneLabel", () => {
  it("returns the timezone that is really used", () => {
    expect(zoneLabel("Europe/Berlin")).toBe("Europe/Berlin");
    expect(zoneLabel("Mars/Olympus")).toBe("UTC");
  });

  it("names a zone written in another case by its canonical name", () => {
    expect(zoneLabel("europe/berlin")).toBe("Europe/Berlin");
    expect(zoneLabel("EUROPE/BERLIN")).toBe("Europe/Berlin");
    expect(formatLocalTime("2026-09-30T12:00:00Z", "eUrOpE/bErLiN")).toBe("30 Sep 2026, 14:00 (Europe/Berlin)");
  });
});

describe("localInputToIso", () => {
  it("adds the offset the timezone had at that local time", () => {
    expect(localInputToIso("2026-09-20T12:00", "America/Chicago")).toEqual({
      ok: true,
      iso: "2026-09-20T12:00:00-05:00",
    });
    expect(localInputToIso("2026-01-15T08:30", "Europe/Berlin")).toEqual({
      ok: true,
      iso: "2026-01-15T08:30:00+01:00",
    });
    expect(localInputToIso("2026-07-15T08:30", "Europe/Berlin")).toEqual({
      ok: true,
      iso: "2026-07-15T08:30:00+02:00",
    });
  });

  it("handles a half hour offset and UTC", () => {
    expect(localInputToIso("2026-09-20T12:00", "Asia/Kolkata")).toEqual({ ok: true, iso: "2026-09-20T12:00:00+05:30" });
    expect(localInputToIso("2026-09-20T12:00", "UTC")).toEqual({ ok: true, iso: "2026-09-20T12:00:00+00:00" });
  });

  it("keeps seconds when the control supplies them", () => {
    expect(localInputToIso("2026-09-20T12:00:45", "UTC")).toEqual({ ok: true, iso: "2026-09-20T12:00:45+00:00" });
  });

  it("produces a string the capture time rule accepts, equal to the same instant", () => {
    const result = localInputToIso("2026-09-20T12:00", "America/Chicago");
    if (!result.ok) throw new Error("expected a time");
    expect(parseCaptureTime(result.iso, NOW)).toBe("2026-09-20T17:00:00+00:00");
  });

  it("uses the first occurrence of a local time that happens twice", () => {
    // Clocks in Chicago go back from 02:00 to 01:00 on 1 Nov 2026.
    expect(localInputToIso("2026-11-01T01:30", "America/Chicago")).toEqual({
      ok: true,
      iso: "2026-11-01T01:30:00-05:00",
    });
  });

  it("refuses a local time that the clocks skipped", () => {
    // Clocks in Chicago go forward from 02:00 to 03:00 on 8 Mar 2026.
    const result = localInputToIso("2026-03-08T02:30", "America/Chicago");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.message).toContain("does not exist");
    expect(result.message).toContain("America/Chicago");
  });

  it("refuses text that is not a date and time, and a date that does not exist", () => {
    for (const value of ["", "2026-09-20", "20/09/2026 12:00", "2026-02-30T10:00", "2026-09-20T25:00"]) {
      const result = localInputToIso(value, "UTC");
      expect(result.ok, value).toBe(false);
    }
  });
});
