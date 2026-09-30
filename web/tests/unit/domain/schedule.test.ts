import { describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors";
import { isValidTimezone, localDateKey, nextReviewAt } from "@/domain/schedule";

const at = (iso: string): Date => new Date(iso);
const next = (iso: string, timezone: string, hour: number): string =>
  nextReviewAt(at(iso), timezone, hour).toISOString();

describe("isValidTimezone", () => {
  it.each(["UTC", "America/Chicago", "Europe/London", "Australia/Lord_Howe", "Asia/Kolkata", "Etc/GMT+5"])(
    "accepts %s",
    (timezone) => {
      expect(isValidTimezone(timezone)).toBe(true);
    },
  );

  it.each(["", " ", "Mars/Olympus", "+05:00", "-0600", "America/Chicago ", "UTC\n", "a".repeat(200), 5, null, undefined, {}])(
    "rejects %j",
    (timezone) => {
      expect(isValidTimezone(timezone)).toBe(false);
    },
  );
});

describe("localDateKey", () => {
  it("uses the local calendar date", () => {
    expect(localDateKey(at("2026-03-08T05:59:59Z"), "America/Chicago")).toBe("2026-03-07");
    expect(localDateKey(at("2026-03-08T06:00:00Z"), "America/Chicago")).toBe("2026-03-08");
    expect(localDateKey(at("2026-09-30T23:59:59Z"), "UTC")).toBe("2026-09-30");
    expect(localDateKey(at("2026-10-01T00:00:00Z"), "UTC")).toBe("2026-10-01");
    expect(localDateKey(at("2026-06-30T23:00:00Z"), "Europe/London")).toBe("2026-07-01");
    expect(localDateKey(at("2026-10-03T13:29:59Z"), "Australia/Lord_Howe")).toBe("2026-10-03");
    expect(localDateKey(at("2026-10-03T13:30:00Z"), "Australia/Lord_Howe")).toBe("2026-10-04");
  });

  it("rejects an unknown timezone", () => {
    expect(() => localDateKey(at("2026-03-08T06:00:00Z"), "Mars/Olympus")).toThrow(DomainError);
  });
});

describe("nextReviewAt", () => {
  describe("UTC", () => {
    it("returns the next top of the hour strictly after now", () => {
      expect(next("2026-09-29T23:59:59.999Z", "UTC", 0)).toBe("2026-09-30T00:00:00.000Z");
      expect(next("2026-09-30T00:00:00Z", "UTC", 0)).toBe("2026-10-01T00:00:00.000Z");
      expect(next("2026-09-30T00:00:00.001Z", "UTC", 0)).toBe("2026-10-01T00:00:00.000Z");
      expect(next("2026-09-30T12:00:00Z", "UTC", 23)).toBe("2026-09-30T23:00:00.000Z");
      expect(next("2026-09-30T23:00:00Z", "UTC", 23)).toBe("2026-10-01T23:00:00.000Z");
      expect(next("2026-12-31T23:30:00Z", "UTC", 9)).toBe("2027-01-01T09:00:00.000Z");
    });
  });

  describe("America/Chicago, spring forward on 2026-03-08", () => {
    it("moves a time inside the gap to the first valid instant after it", () => {
      expect(next("2026-03-08T07:00:00Z", "America/Chicago", 2)).toBe("2026-03-08T08:00:00.000Z");
      expect(next("2026-03-08T07:59:59Z", "America/Chicago", 2)).toBe("2026-03-08T08:00:00.000Z");
    });

    it("goes to the next day once the moved instant has passed", () => {
      expect(next("2026-03-08T08:00:00Z", "America/Chicago", 2)).toBe("2026-03-09T07:00:00.000Z");
    });

    it("keeps times outside the gap", () => {
      expect(next("2026-03-08T06:30:00Z", "America/Chicago", 1)).toBe("2026-03-08T07:00:00.000Z");
      expect(next("2026-03-08T07:00:00Z", "America/Chicago", 3)).toBe("2026-03-08T08:00:00.000Z");
    });

    it("spans the 23 hour day", () => {
      expect(next("2026-03-07T18:00:00Z", "America/Chicago", 12)).toBe("2026-03-08T17:00:00.000Z");
    });
  });

  describe("America/Chicago, fall back on 2026-11-01", () => {
    it("uses the first occurrence of a repeated hour", () => {
      expect(next("2026-11-01T05:30:00Z", "America/Chicago", 1)).toBe("2026-11-01T06:00:00.000Z");
    });

    it("does not schedule the second occurrence on the same local date", () => {
      expect(next("2026-11-01T06:00:00Z", "America/Chicago", 1)).toBe("2026-11-02T07:00:00.000Z");
      expect(next("2026-11-01T06:30:00Z", "America/Chicago", 1)).toBe("2026-11-02T07:00:00.000Z");
    });

    it("keeps times outside the repeated hour", () => {
      expect(next("2026-11-01T04:00:00Z", "America/Chicago", 0)).toBe("2026-11-01T05:00:00.000Z");
      expect(next("2026-11-01T05:30:00Z", "America/Chicago", 2)).toBe("2026-11-01T08:00:00.000Z");
    });

    it("spans the 25 hour day", () => {
      expect(next("2026-10-31T17:00:00Z", "America/Chicago", 12)).toBe("2026-11-01T18:00:00.000Z");
    });
  });

  describe("Europe/London", () => {
    it("handles the gap on 2026-03-29", () => {
      expect(next("2026-03-29T00:30:00Z", "Europe/London", 1)).toBe("2026-03-29T01:00:00.000Z");
      expect(next("2026-03-29T01:00:00Z", "Europe/London", 1)).toBe("2026-03-30T00:00:00.000Z");
    });

    it("handles the repeated hour on 2026-10-25", () => {
      expect(next("2026-10-24T23:30:00Z", "Europe/London", 1)).toBe("2026-10-25T00:00:00.000Z");
      expect(next("2026-10-25T00:00:00Z", "Europe/London", 1)).toBe("2026-10-26T01:00:00.000Z");
    });

    it("follows summer and winter offsets", () => {
      expect(next("2026-06-15T07:59:59Z", "Europe/London", 9)).toBe("2026-06-15T08:00:00.000Z");
      expect(next("2026-06-15T08:00:00Z", "Europe/London", 9)).toBe("2026-06-16T08:00:00.000Z");
      expect(next("2026-01-15T08:00:00Z", "Europe/London", 9)).toBe("2026-01-15T09:00:00.000Z");
    });
  });

  describe("Australia/Lord_Howe, a thirty minute shift", () => {
    it("moves 02:00 past the half hour gap on 2026-10-04", () => {
      expect(next("2026-10-03T15:00:00Z", "Australia/Lord_Howe", 2)).toBe("2026-10-03T15:30:00.000Z");
      expect(next("2026-10-03T15:30:00Z", "Australia/Lord_Howe", 2)).toBe("2026-10-04T15:00:00.000Z");
    });

    it("finds 02:00 once on the fall back day 2026-04-05", () => {
      expect(next("2026-04-04T14:30:00Z", "Australia/Lord_Howe", 2)).toBe("2026-04-04T15:30:00.000Z");
      expect(next("2026-04-04T13:30:00Z", "Australia/Lord_Howe", 1)).toBe("2026-04-04T14:00:00.000Z");
    });

    it("uses the half hour offset on ordinary days", () => {
      expect(next("2026-07-01T00:00:00Z", "Australia/Lord_Howe", 9)).toBe("2026-07-01T22:30:00.000Z");
      expect(next("2026-12-01T00:00:00Z", "Australia/Lord_Howe", 9)).toBe("2026-12-01T22:00:00.000Z");
    });
  });

  it.each([
    ["America/Chicago", 1],
    ["America/Chicago", 2],
    ["America/Chicago", 12],
    ["Europe/London", 1],
    ["Australia/Lord_Howe", 2],
    ["UTC", 0],
  ])("schedules exactly one review per local date across a year in %s at hour %i", (timezone, hour) => {
    let cursor = at("2025-12-31T00:00:00Z");
    const keys: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      const scheduled = nextReviewAt(cursor, timezone, hour);
      expect(scheduled.getTime()).toBeGreaterThan(cursor.getTime());
      const gap = scheduled.getTime() - cursor.getTime();
      if (index > 0) {
        expect(gap).toBeGreaterThanOrEqual(23 * 3_600_000);
        expect(gap).toBeLessThanOrEqual(25 * 3_600_000);
      }
      keys.push(localDateKey(scheduled, timezone));
      cursor = scheduled;
    }
    expect(new Set(keys).size).toBe(keys.length);
    for (let index = 1; index < keys.length; index += 1) {
      const previous = Date.parse(`${keys[index - 1]}T00:00:00Z`);
      expect(Date.parse(`${keys[index]}T00:00:00Z`) - previous).toBe(86_400_000);
    }
  });

  it("rejects an hour outside 0 to 23", () => {
    for (const hour of [-1, 24, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => nextReviewAt(at("2026-09-30T12:00:00Z"), "UTC", hour)).toThrow(DomainError);
    }
  });

  it("rejects an unknown timezone and an invalid clock", () => {
    expect(() => nextReviewAt(at("2026-09-30T12:00:00Z"), "Mars/Olympus", 9)).toThrow(DomainError);
    expect(() => nextReviewAt(new Date(Number.NaN), "UTC", 9)).toThrow(TypeError);
  });
});
