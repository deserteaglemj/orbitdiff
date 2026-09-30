import { describe, expect, it } from "vitest";

import { capacityItems, type CapacityItem } from "@/components/admin/capacity";
import type { CapacityDto, TickSummaryDto } from "@/server/services/contracts";

const NOW = new Date("2026-09-30T12:00:00Z");
const MB = 1024 * 1024;

const tick: TickSummaryDto = {
  at: "2026-09-30T11:30:00.000Z",
  recovered: 1,
  enqueued: 4,
  claimed: 5,
  succeeded: 3,
  failed: 1,
  retried: 1,
  cancelled: 0,
  remaining: 2,
  cleaned: 7,
  durationMs: 1840,
  pausedForCapacity: false,
};

const healthy: CapacityDto = {
  users: { used: 12, limit: 250, paused: false },
  jobsToday: { used: 150, limit: 2000, paused: false },
  database: { bytes: 120 * MB, limit: 400 * MB, paused: false, measuredAt: "2026-09-30T11:30:00.000Z" },
  lastTick: tick,
  mail: { available: true, mode: "captured" },
  registration: { open: true, reason: null },
};

function item(capacity: CapacityDto, key: CapacityItem["key"], now: Date = NOW): CapacityItem {
  const found = capacityItems(capacity, now).find((entry) => entry.key === key);
  if (!found) throw new Error(`no capacity item ${key}`);
  return found;
}

describe("capacityItems", () => {
  it("lists the six things the operator watches, in a fixed order", () => {
    expect(capacityItems(healthy, NOW).map((entry) => [entry.key, entry.title])).toEqual([
      ["users", "Verified accounts"],
      ["jobsToday", "Jobs today"],
      ["database", "Database size"],
      ["mail", "Account mail"],
      ["registration", "Registration"],
      ["lastTick", "Last batch run"],
    ]);
  });

  it("shows nothing as paused on a healthy deployment", () => {
    expect(capacityItems(healthy, NOW).filter((entry) => entry.paused)).toEqual([]);
  });

  describe("accounts against the cap", () => {
    it("shows the count against the cap", () => {
      expect(item(healthy, "users")).toMatchObject({
        title: "Verified accounts",
        value: "12 of 250 verified accounts",
        badge: "Within the cap",
        tone: "ok",
        paused: false,
        detail:
          "The cap is not reached, so it does not pause registration. Accounts that wait for verification do not count.",
      });
    });

    it("says near the cap from 80 percent", () => {
      const near = { ...healthy, users: { used: 200, limit: 250, paused: false } };
      expect(item(near, "users")).toMatchObject({ badge: "Near the cap", tone: "info", paused: false });
    });

    it("shows a paused state and what it pauses when the cap is reached", () => {
      const full = { ...healthy, users: { used: 250, limit: 250, paused: true } };
      expect(item(full, "users")).toMatchObject({
        value: "250 of 250 verified accounts",
        badge: "Paused",
        tone: "warning",
        paused: true,
        detail: "Registration is paused: the cap on verified accounts is reached. Existing accounts are not affected.",
      });
    });

    it("is paused at the cap even when the flag is missing, so a reached cap is never shown as fine", () => {
      const odd = { ...healthy, users: { used: 251, limit: 250, paused: false } };
      expect(item(odd, "users")).toMatchObject({ badge: "Paused", paused: true });
    });
  });

  describe("jobs today against the cap", () => {
    it("shows the count against the cap with thousands separators", () => {
      expect(item(healthy, "jobsToday")).toMatchObject({
        value: "150 of 2,000 jobs",
        badge: "Within the cap",
        paused: false,
        detail: "The cap is not reached, so it does not pause scheduled reviews.",
      });
    });

    it("shows a paused state and what it pauses when the cap is reached", () => {
      const full = { ...healthy, jobsToday: { used: 2000, limit: 2000, paused: true } };
      expect(item(full, "jobsToday")).toMatchObject({
        badge: "Paused",
        tone: "warning",
        paused: true,
        detail: "Scheduled reviews are paused: the daily job cap is reached. They resume on the next UTC day.",
      });
    });
  });

  describe("measured database size against the cap", () => {
    it("shows the measured size against the cap and when it was measured", () => {
      expect(item(healthy, "database")).toMatchObject({
        value: "120 MB of 400 MB",
        badge: "Within the cap",
        tone: "ok",
        paused: false,
        detail: "The cap is not reached, so it does not pause imports.",
        facts: [{ label: "Measured", value: "30 Sep 2026, 11:30 (UTC)" }],
      });
    });

    it("says Unknown, never zero, when the size has not been measured", () => {
      const unmeasured = { ...healthy, database: { bytes: null, limit: 400 * MB, paused: false, measuredAt: null } };
      expect(item(unmeasured, "database")).toMatchObject({
        value: "Unknown of 400 MB",
        badge: "Not measured",
        tone: "neutral",
        paused: false,
        detail: "The database size has not been measured yet. The batch run measures it. An unknown size pauses nothing.",
        facts: [{ label: "Measured", value: "Never" }],
      });
    });

    it("shows a paused state and what it pauses when the cap is reached", () => {
      const full = {
        ...healthy,
        database: { bytes: 400 * MB, limit: 400 * MB, paused: true, measuredAt: "2026-09-30T11:30:00.000Z" },
      };
      expect(item(full, "database")).toMatchObject({
        value: "400 MB of 400 MB",
        badge: "Paused",
        tone: "warning",
        paused: true,
        detail: "Imports are paused: the measured database size has reached the cap. Stored data is unchanged.",
      });
    });
  });

  describe("account mail", () => {
    it("says captured mail is stored and not sent", () => {
      expect(item(healthy, "mail")).toMatchObject({
        value: "Captured",
        badge: "Stored, not sent",
        tone: "info",
        paused: false,
        detail: "Account messages are stored instead of sent. The operator can read them, including their links.",
      });
    });

    it("shows a paused state when no mail can be handled", () => {
      const none: CapacityDto = { ...healthy, mail: { available: false, mode: "none" } };
      expect(item(none, "mail")).toMatchObject({
        value: "None",
        badge: "Paused",
        tone: "warning",
        paused: true,
        detail: "No account message can be stored or sent, so registration is closed and no confirmation or reset message can be requested.",
      });
    });

    it("treats mail that is not available as none, whatever the mode says", () => {
      const odd: CapacityDto = { ...healthy, mail: { available: false, mode: "captured" } };
      expect(item(odd, "mail")).toMatchObject({ value: "None", paused: true });
    });
  });

  describe("registration", () => {
    it("says open when it is open", () => {
      expect(item(healthy, "registration")).toMatchObject({
        value: "Open",
        badge: "Open",
        tone: "ok",
        paused: false,
        detail: "New accounts can be created.",
      });
    });

    it("shows closed with the reason", () => {
      const reason = "Registration is closed: email delivery is not configured.";
      const closed = { ...healthy, registration: { open: false, reason } };
      expect(item(closed, "registration")).toMatchObject({
        value: "Not open",
        badge: "Closed",
        tone: "warning",
        paused: true,
        detail: reason,
      });
    });

    it("shows paused with the reason when capacity is reached", () => {
      const reason = "Registration is paused: capacity reached.";
      const paused = { ...healthy, registration: { open: false, reason } };
      expect(item(paused, "registration")).toMatchObject({ badge: "Paused", paused: true, detail: reason });
    });

    it("says so when no reason was recorded", () => {
      const closed = { ...healthy, registration: { open: false, reason: null } };
      expect(item(closed, "registration").detail).toBe("Registration is not open. No reason was recorded.");
    });

    it("treats anything but open true as not open", () => {
      for (const open of [undefined, null, "true", 1]) {
        const odd = { ...healthy, registration: { open, reason: null } } as unknown as CapacityDto;
        expect(item(odd, "registration"), String(open)).toMatchObject({ value: "Not open", paused: true });
      }
    });
  });

  describe("the last batch run", () => {
    it("shows its time and its counts", () => {
      expect(item(healthy, "lastTick")).toMatchObject({
        value: "30 Sep 2026, 11:30 (UTC)",
        badge: "On schedule",
        tone: "ok",
        paused: false,
        detail: "The batch run is expected every hour.",
        facts: [
          { label: "Expired leases recovered", value: "1" },
          { label: "Daily reviews queued", value: "4" },
          { label: "Jobs claimed", value: "5" },
          { label: "Succeeded", value: "3" },
          { label: "Failed", value: "1" },
          { label: "Retried", value: "1" },
          { label: "Cancelled", value: "0" },
          { label: "Still waiting", value: "2" },
          { label: "Old rows removed", value: "7" },
          { label: "Duration", value: "1,840 ms" },
        ],
      });
    });

    it("shows a paused state when the run found the daily job cap reached", () => {
      const paused = { ...healthy, lastTick: { ...tick, pausedForCapacity: true } };
      expect(item(paused, "lastTick")).toMatchObject({
        badge: "Paused for capacity",
        tone: "warning",
        paused: true,
        detail: "That run found the daily job cap reached, so scheduled reviews were paused.",
      });
    });

    it("says the run is late when the last one is more than two hours old", () => {
      const late = item(healthy, "lastTick", new Date("2026-09-30T13:30:01Z"));
      expect(late).toMatchObject({
        badge: "Late",
        tone: "warning",
        paused: false,
        detail: "The last batch run was more than two hours ago. It is expected every hour.",
      });
      expect(item(healthy, "lastTick", new Date("2026-09-30T13:30:00Z")).badge).toBe("On schedule");
    });

    it("says so when no run has been recorded", () => {
      expect(item({ ...healthy, lastTick: null }, "lastTick")).toEqual({
        key: "lastTick",
        title: "Last batch run",
        value: "None recorded",
        badge: "Not run yet",
        tone: "warning",
        paused: false,
        detail: "No batch run has been recorded. The hourly workflow starts it.",
        facts: [],
      });
    });

    it("says Unknown for a run whose time cannot be read, and does not call it on schedule", () => {
      const odd = { ...healthy, lastTick: { ...tick, at: "not a time" } };
      expect(item(odd, "lastTick")).toMatchObject({ value: "Unknown", badge: "Unknown", tone: "neutral" });
    });
  });
});
