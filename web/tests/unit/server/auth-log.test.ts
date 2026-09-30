import { afterEach, describe, expect, it, vi } from "vitest";

import { authLog } from "@/server/auth/log";
import { isValidTimeZone } from "@/server/auth/timezone";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authLog", () => {
  it("writes one redacted line for an error with attached values", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authLog(
      "error",
      "Failed to create user atlas@orbitdiff.test",
      new Error("insert failed params: nova@orbitdiff.test"),
      { token: "should-never-print" },
    );
    expect(logged).toHaveBeenCalledOnce();
    const line = logged.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain("[auth]");
    expect(line).not.toContain("atlas@orbitdiff.test");
    expect(line).not.toContain("nova@orbitdiff.test");
    expect(line).not.toContain("should-never-print");
  });

  it("routes warnings to console.warn", () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    authLog("warn", "Invalid password");
    expect(warned).toHaveBeenCalledWith("[auth] Invalid password");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zone names", () => {
    for (const zone of ["UTC", "Europe/Berlin", "America/Argentina/Buenos_Aires", "Asia/Kolkata"]) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
  });

  it("rejects offsets, unknown zones, and non-strings", () => {
    for (const zone of ["+05:00", "Mars/Olympus", "", " UTC", "Europe/Berlin; drop", 5, null, undefined]) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });
});
