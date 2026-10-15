import { describe, expect, it } from "vitest";

import { describeRefusal, readApiRefusal } from "@/components/dashboard/api";

const envelope = (code: string, message: string, details?: Record<string, unknown>) =>
  JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } });

describe("readApiRefusal", () => {
  it("reads the code, the message, and the details of the error envelope", () => {
    const refusal = readApiRefusal(
      429,
      envelope("cooldown", "This profile was reviewed a moment ago. Try again after the cooldown.", {
        retryAfterSeconds: 1500,
      }),
    );
    expect(refusal).toEqual({
      status: 429,
      code: "cooldown",
      message: "This profile was reviewed a moment ago. Try again after the cooldown.",
      fields: [],
      details: { retryAfterSeconds: 1500 },
    });
  });

  it("has empty details when the route sent none", () => {
    expect(readApiRefusal(404, envelope("not_found", "Not found.")).details).toEqual({});
  });

  it("turns a body that is not the envelope into a plain sentence with the status", () => {
    const refusal = readApiRefusal(502, "<html>bad gateway</html>");
    expect(refusal.code).toBe("unknown");
    expect(refusal.message).toContain("502");
    expect(refusal.details).toEqual({});
  });
});

describe("describeRefusal", () => {
  it("adds how long the cooldown still runs", () => {
    expect(
      describeRefusal(
        {
          code: "cooldown",
          message: "This profile was reviewed a moment ago. Try again after the cooldown.",
          details: { retryAfterSeconds: 1500 },
        },
        "UTC",
      ),
    ).toBe(
      "This profile was reviewed a moment ago. Try again after the cooldown. You can try again in about 25 minutes.",
    );
  });

  it("rounds the wait up and handles one minute and less", () => {
    const base = { code: "cooldown", message: "Wait." };
    expect(describeRefusal({ ...base, details: { retryAfterSeconds: 61 } }, "UTC")).toBe(
      "Wait. You can try again in about 2 minutes.",
    );
    expect(describeRefusal({ ...base, details: { retryAfterSeconds: 60 } }, "UTC")).toBe(
      "Wait. You can try again in about 1 minute.",
    );
    expect(describeRefusal({ ...base, details: { retryAfterSeconds: 20 } }, "UTC")).toBe(
      "Wait. You can try again in less than a minute.",
    );
  });

  it("adds when a daily limit starts again, in the user's timezone", () => {
    expect(
      describeRefusal(
        {
          code: "quota_exhausted",
          message:
            "This profile has used all 3 manual reviews for today. Manual reviews are paused until the next UTC day.",
          details: { quota: "manual_reviews_per_day", limit: 3, resetsAt: "2026-10-01T00:00:00.000Z" },
        },
        "America/Chicago",
      ),
    ).toBe(
      "This profile has used all 3 manual reviews for today. Manual reviews are paused until the next UTC day. The limit starts again at 30 Sep 2026, 19:00 (America/Chicago).",
    );
  });

  it("shows any other refusal with the route's own message", () => {
    expect(
      describeRefusal(
        { code: "conflict", message: "This profile is paused. Resume it to run a review.", details: { paused: true } },
        "UTC",
      ),
    ).toBe("This profile is paused. Resume it to run a review.");
    expect(
      describeRefusal({ code: "cooldown", message: "Wait.", details: { retryAfterSeconds: "soon" } }, "UTC"),
    ).toBe("Wait.");
  });
});
