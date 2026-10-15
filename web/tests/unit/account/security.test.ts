import { describe, expect, it } from "vitest";

import {
  buildPasswordChangeRequest,
  describeSecurityError,
  describeUserAgent,
  sessionRows,
  validatePasswordChange,
} from "@/components/settings/security";

const CURRENT = "copper lantern orbit";
const NEXT = "silver harbour comet";

describe("validatePasswordChange", () => {
  it("accepts the current password, a new one of at least 10 characters, and the same one again", () => {
    expect(validatePasswordChange({ currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT })).toEqual({});
  });

  it("requires the current password", () => {
    const errors = validatePasswordChange({ currentPassword: "", newPassword: NEXT, confirmPassword: NEXT });
    expect(errors).toEqual({ currentPassword: "Enter your current password." });
  });

  it("requires a new password of at least 10 characters", () => {
    const errors = validatePasswordChange({ currentPassword: CURRENT, newPassword: "short", confirmPassword: "short" });
    expect(errors).toEqual({ newPassword: "Use at least 10 characters." });
  });

  it("refuses a new password above 128 characters", () => {
    const long = "a".repeat(129);
    const errors = validatePasswordChange({ currentPassword: CURRENT, newPassword: long, confirmPassword: long });
    expect(errors).toEqual({ newPassword: "Use at most 128 characters." });
  });

  it("requires the new password to be typed the same way twice", () => {
    const errors = validatePasswordChange({ currentPassword: CURRENT, newPassword: NEXT, confirmPassword: `${NEXT} ` });
    expect(errors).toEqual({ confirmPassword: "The two passwords are not the same." });
  });

  it("reports every field that is wrong", () => {
    expect(Object.keys(validatePasswordChange({ currentPassword: "", newPassword: "x", confirmPassword: "y" }))).toEqual([
      "currentPassword",
      "newPassword",
      "confirmPassword",
    ]);
  });
});

describe("buildPasswordChangeRequest", () => {
  it("sends both passwords as typed and always signs the other devices out", () => {
    expect(buildPasswordChangeRequest({ currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT })).toEqual({
      currentPassword: CURRENT,
      newPassword: NEXT,
      revokeOtherSessions: true,
    });
  });
});

describe("describeSecurityError", () => {
  it("puts a wrong current password on its field", () => {
    expect(describeSecurityError({ status: 400, code: "INVALID_PASSWORD", message: "Invalid password" })).toEqual({
      kind: "field",
      field: "currentPassword",
      message: "That is not your current password.",
    });
  });

  it("puts a new password the server finds too short on its field", () => {
    expect(describeSecurityError({ status: 400, code: "PASSWORD_TOO_SHORT", message: "Password too short" })).toEqual({
      kind: "field",
      field: "newPassword",
      message: "Use at least 10 characters.",
    });
  });

  it("puts a new password the server finds too long on its field", () => {
    expect(describeSecurityError({ status: 400, code: "PASSWORD_TOO_LONG", message: "Password too long" })).toEqual({
      kind: "field",
      field: "newPassword",
      message: "Use at most 128 characters.",
    });
  });

  it("says the session list needs a recent sign-in when the session is not fresh", () => {
    expect(describeSecurityError({ status: 403, code: "SESSION_NOT_FRESH", message: "Session is not fresh" })).toEqual({
      kind: "not_fresh",
      message:
        "The list of signed-in devices is shown only during the first day after you sign in. Sign out and sign in again to see it.",
    });
  });

  it("says the login ended when the server no longer knows the session", () => {
    const expected = { kind: "signed_out", message: "You are signed out on this device. Sign in again to continue." };
    expect(describeSecurityError({ status: 401, code: "UNAUTHORIZED", message: "Unauthorized" })).toEqual(expected);
    expect(describeSecurityError({ status: 401 })).toEqual(expected);
  });

  it("says to wait when the server limits the attempts", () => {
    expect(describeSecurityError({ status: 429, message: "Too many requests." })).toEqual({
      kind: "form",
      message: "Too many attempts. Wait a minute, then try again.",
    });
  });

  it("shows any other refusal with the server's own message", () => {
    expect(describeSecurityError({ status: 403, code: "ACCOUNT_SUSPENDED", message: "This account is suspended." })).toEqual({
      kind: "form",
      message: "This account is suspended.",
    });
    expect(
      describeSecurityError({ status: 403, error: { code: "forbidden_origin", message: "This request came from another site." } }),
    ).toEqual({ kind: "form", message: "This request came from another site." });
  });

  it("falls back to a plain sentence for an error with no message", () => {
    expect(describeSecurityError(undefined)).toEqual({ kind: "form", message: "Something went wrong. Try again shortly." });
  });
});

describe("describeUserAgent", () => {
  const MAC_CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const WIN_EDGE =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
  const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const LINUX_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
  const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

  it.each([
    [MAC_CHROME, "Chrome on macOS"],
    [WIN_EDGE, "Edge on Windows"],
    [IPHONE_SAFARI, "Safari on iPhone"],
    [LINUX_FIREFOX, "Firefox on Linux"],
    [ANDROID_CHROME, "Chrome on Android"],
  ])("names the browser and the system: %s", (agent, expected) => {
    expect(describeUserAgent(agent)).toBe(expected);
  });

  it("names only what it recognizes", () => {
    expect(describeUserAgent("curl/8.7.1")).toBe("Unknown browser");
    expect(describeUserAgent("SomeBot/1.0 (Windows NT 10.0)")).toBe("Unknown browser on Windows");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["not text", 12],
  ])("says Unknown device when the description is %s", (_label, agent) => {
    expect(describeUserAgent(agent)).toBe("Unknown device");
  });

  it("never repeats the raw description, which the device controls", () => {
    const hostile = "<script>alert(1)</script> Chrome/1.0 Windows";
    expect(describeUserAgent(hostile)).toBe("Chrome on Windows");
  });
});

describe("sessionRows", () => {
  const older = {
    id: "s-older",
    token: "token-older",
    createdAt: "2026-09-28T08:00:00.000Z",
    expiresAt: "2026-10-05T08:00:00.000Z",
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  };
  const current = {
    id: "s-current",
    token: "token-current",
    createdAt: new Date("2026-09-29T09:00:00.000Z"),
    expiresAt: new Date("2026-10-06T09:00:00.000Z"),
    ipAddress: "",
    userAgent: null,
  };
  const newest = { ...older, id: "s-newest", token: "token-newest", createdAt: "2026-09-30T07:00:00.000Z" };

  it("puts this device first, then the others from the newest sign-in to the oldest", () => {
    const rows = sessionRows([older, current, newest], "token-current");
    expect(rows.map((row) => [row.key, row.current])).toEqual([
      ["s-current", true],
      ["s-newest", false],
      ["s-older", false],
    ]);
  });

  it("describes each session without printing what the device sent", () => {
    const [first, second] = sessionRows([older, current], "token-current");
    expect(first).toEqual({
      key: "s-current",
      token: "token-current",
      current: true,
      device: "Unknown device",
      address: "Unknown",
      signedInAt: "2026-09-29T09:00:00.000Z",
      expiresAt: "2026-10-06T09:00:00.000Z",
    });
    expect(second).toMatchObject({
      device: "Firefox on Linux",
      address: "203.0.113.7",
      signedInAt: "2026-09-28T08:00:00.000Z",
      expiresAt: "2026-10-05T08:00:00.000Z",
    });
  });

  it("marks no session as this device when the current one is not known", () => {
    expect(sessionRows([older, newest], null).every((row) => !row.current)).toBe(true);
  });

  it("leaves out an entry that has no token, because it could not be signed out", () => {
    const rows = sessionRows([older, { id: "s-odd", createdAt: "2026-09-30T07:00:00.000Z" }, null, "text"], null);
    expect(rows.map((row) => row.key)).toEqual(["s-older"]);
  });

  it("gives a session without an id a key that is not its token", () => {
    const [row] = sessionRows([{ ...older, id: undefined }], null);
    expect(row?.key).toBe("session-1");
    expect(row?.key).not.toContain("token");
  });

  it("reads a time it cannot parse as unknown", () => {
    const [row] = sessionRows([{ ...older, createdAt: "not a time", expiresAt: 7 }], null);
    expect(row).toMatchObject({ signedInAt: null, expiresAt: null });
  });

  it.each([
    ["null", null],
    ["an object", { sessions: [] }],
    ["text", "sessions"],
  ])("returns no rows for an answer that is %s", (_label, answer) => {
    expect(sessionRows(answer, "token-current")).toEqual([]);
  });
});
