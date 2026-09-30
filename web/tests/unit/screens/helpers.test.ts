import { describe, expect, it } from "vitest";

import { single } from "@/app/(auth)/query";
import { listTimezones, timezoneOptions } from "@/components/auth/timezones";
import { isValidTimezone } from "@/domain/schedule";

describe("listTimezones", () => {
  const zones = listTimezones();

  it("starts with UTC and lists it once", () => {
    expect(zones[0]).toBe("UTC");
    expect(zones.filter((zone) => zone === "UTC")).toHaveLength(1);
  });

  it("lists only names the sign-up gate accepts", () => {
    expect(zones.length).toBeGreaterThan(50);
    expect(zones.filter((zone) => !isValidTimezone(zone))).toEqual([]);
  });

  it("includes common zones", () => {
    for (const zone of ["Europe/Berlin", "America/Chicago", "Asia/Tokyo"]) expect(zones).toContain(zone);
  });

  it("still offers a valid name the runtime lists under another spelling, once a browser reports it", () => {
    // The runtime lists one spelling per zone (for example Asia/Calcutta), a browser may report the other.
    const reported = zones.includes("Asia/Kolkata") ? "Asia/Calcutta" : "Asia/Kolkata";
    expect(isValidTimezone(reported)).toBe(true);
    expect(timezoneOptions(zones, reported)[0]).toEqual({ value: reported, label: reported });
  });
});

describe("timezoneOptions", () => {
  const zones = ["UTC", "Europe/Berlin", "America/Argentina/Buenos_Aires"];

  it("offers every zone once, with underscores shown as spaces", () => {
    expect(timezoneOptions(zones, "UTC")).toEqual([
      { value: "UTC", label: "UTC" },
      { value: "Europe/Berlin", label: "Europe/Berlin" },
      { value: "America/Argentina/Buenos_Aires", label: "America/Argentina/Buenos Aires" },
    ]);
  });

  it("adds the selected zone when the list lacks it and it is a valid name", () => {
    expect(timezoneOptions(zones, "Asia/Kolkata").map((option) => option.value)).toEqual(["Asia/Kolkata", ...zones]);
  });

  it("does not add a selected value that is not a timezone", () => {
    expect(timezoneOptions(zones, "Mars/Olympus").map((option) => option.value)).toEqual(zones);
    expect(timezoneOptions(zones, "").map((option) => option.value)).toEqual(zones);
  });
});

describe("single: one bounded query value", () => {
  it("returns a value that was given once", () => {
    expect(single("/settings")).toBe("/settings");
  });

  it("returns null for a missing, empty, repeated, or oversized value", () => {
    expect(single(undefined)).toBeNull();
    expect(single("")).toBeNull();
    expect(single(["/a", "/b"])).toBeNull();
    expect(single("a".repeat(2_049))).toBeNull();
    expect(single("a".repeat(11), 10)).toBeNull();
    expect(single("a".repeat(10), 10)).toBe("a".repeat(10));
  });
});
