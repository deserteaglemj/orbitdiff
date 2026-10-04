import { describe, expect, it } from "vitest";

import { buildTimezoneList, FALLBACK_TIMEZONES, filterTimezones, timezoneLabel } from "@/components/settings/timezones";
import { isValidTimezone } from "@/domain/schedule";

const runtime = (zones: unknown) => ({ supportedValuesOf: () => zones });

describe("buildTimezoneList", () => {
  it("offers the zones the runtime reports, with UTC first", () => {
    const list = buildTimezoneList("UTC", runtime(["America/Chicago", "Europe/Berlin"]));
    expect(list).toEqual({ source: "runtime", zones: ["UTC", "America/Chicago", "Europe/Berlin"] });
  });

  it("asks the runtime for time zones and nothing else", () => {
    const asked: unknown[] = [];
    buildTimezoneList("UTC", {
      supportedValuesOf: (key: unknown) => {
        asked.push(key);
        return ["Europe/Berlin"];
      },
    });
    expect(asked).toEqual(["timeZone"]);
  });

  it("lists UTC once when the runtime reports it too", () => {
    const list = buildTimezoneList("UTC", runtime(["Europe/Berlin", "UTC"]));
    expect(list.zones).toEqual(["UTC", "Europe/Berlin"]);
  });

  it("adds the current value when the runtime list lacks it, so the control always holds it", () => {
    const list = buildTimezoneList("Asia/Tokyo", runtime(["America/Chicago", "Europe/Berlin"]));
    expect(list.zones).toEqual(["UTC", "America/Chicago", "Asia/Tokyo", "Europe/Berlin"]);
  });

  it("does not add a current value that is not a timezone name", () => {
    const list = buildTimezoneList("Mars/Olympus", runtime(["Europe/Berlin"]));
    expect(list.zones).toEqual(["UTC", "Europe/Berlin"]);
  });

  it("drops entries that are not text and repeated entries", () => {
    const list = buildTimezoneList("UTC", runtime(["Europe/Berlin", 7, null, "Europe/Berlin", ""]));
    expect(list.zones).toEqual(["UTC", "Europe/Berlin"]);
  });

  it("uses the real runtime by default and finds far more zones than the fallback holds", () => {
    const list = buildTimezoneList("Europe/Berlin");
    expect(list.source).toBe("runtime");
    expect(list.zones[0]).toBe("UTC");
    expect(list.zones).toContain("Europe/Berlin");
    expect(list.zones.length).toBeGreaterThan(FALLBACK_TIMEZONES.length);
  });

  describe("falls back to a fixed list of common zones", () => {
    const cases: Array<[string, { supportedValuesOf?: unknown }]> = [
      ["Intl.supportedValuesOf is missing", {}],
      ["Intl.supportedValuesOf is not a function", { supportedValuesOf: "timeZone" }],
      [
        "Intl.supportedValuesOf throws",
        {
          supportedValuesOf: () => {
            throw new RangeError("unsupported key");
          },
        },
      ],
      ["the runtime reports no zones", runtime([])],
      ["the runtime reports something that is not a list", runtime("Europe/Berlin")],
    ];

    it.each(cases)("when %s", (_label, intl) => {
      const list = buildTimezoneList("UTC", intl);
      expect(list.source).toBe("fallback");
      expect(list.zones[0]).toBe("UTC");
      expect(list.zones).toEqual(expect.arrayContaining(["Europe/Berlin", "America/New_York", "Asia/Tokyo"]));
    });

    it("and still shows the current value", () => {
      const list = buildTimezoneList("Africa/Windhoek", {});
      expect(FALLBACK_TIMEZONES).not.toContain("Africa/Windhoek");
      expect(list.zones).toContain("Africa/Windhoek");
    });

    it("and lists each zone once, in order, after UTC", () => {
      const list = buildTimezoneList("UTC", {});
      const rest = list.zones.slice(1);
      expect(new Set(list.zones).size).toBe(list.zones.length);
      expect(rest).toEqual([...rest].sort());
      expect(rest).not.toContain("UTC");
    });
  });

  it("holds only names this runtime accepts in the fallback list", () => {
    expect(FALLBACK_TIMEZONES.length).toBeGreaterThanOrEqual(40);
    for (const zone of FALLBACK_TIMEZONES) expect(isValidTimezone(zone), zone).toBe(true);
  });
});

describe("filterTimezones", () => {
  const zones = ["UTC", "America/Chicago", "America/New_York", "Asia/Tokyo", "Europe/Berlin"];

  it("returns every zone for an empty or blank search", () => {
    expect(filterTimezones(zones, "", "UTC")).toEqual(zones);
    expect(filterTimezones(zones, "   ", "UTC")).toEqual(zones);
  });

  it("matches a part of the name, whatever the letter case", () => {
    expect(filterTimezones(zones, "berl", "Europe/Berlin")).toEqual(["Europe/Berlin"]);
    expect(filterTimezones(zones, "AMERICA", "America/Chicago")).toEqual(["America/Chicago", "America/New_York"]);
  });

  it("reads a space as the underscore or the slash of a name", () => {
    expect(filterTimezones(zones, "new york", "America/New_York")).toEqual(["America/New_York"]);
    expect(filterTimezones(zones, "america chi", "America/Chicago")).toEqual(["America/Chicago"]);
    expect(filterTimezones(zones, "America/New_York", "America/New_York")).toEqual(["America/New_York"]);
  });

  it("keeps the selected zone first when the search does not match it", () => {
    expect(filterTimezones(zones, "tokyo", "Europe/Berlin")).toEqual(["Europe/Berlin", "Asia/Tokyo"]);
  });

  it("returns only the selected zone when nothing matches", () => {
    expect(filterTimezones(zones, "atlantis", "Europe/Berlin")).toEqual(["Europe/Berlin"]);
  });

  it("does not add a selected value that the list does not hold", () => {
    expect(filterTimezones(zones, "tokyo", "Mars/Olympus")).toEqual(["Asia/Tokyo"]);
  });

  it("treats the search text as text, not as a pattern", () => {
    expect(filterTimezones(zones, ".*", "UTC")).toEqual(["UTC"]);
    expect(filterTimezones(zones, "[a-z]+", "UTC")).toEqual(["UTC"]);
  });
});

describe("timezoneLabel", () => {
  it("shows a name with spaces in place of underscores", () => {
    expect(timezoneLabel("America/New_York")).toBe("America/New York");
    expect(timezoneLabel("UTC")).toBe("UTC");
  });
});
