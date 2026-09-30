import { describe, expect, it } from "vitest";

import { describeApiFailure } from "@/components/onboarding/api";
import {
  buildOnboardingBody,
  consentToConfirm,
  initialStep,
  REVIEW_HOUR_OPTIONS,
  validateDetails,
} from "@/components/onboarding/model";
import { CONSENT_VERSIONS } from "@/domain/limits";
import type { ConsentStateDto } from "@/server/services/contracts";

const granted = (kind: "terms" | "privacy") => ({
  granted: true,
  version: CONSENT_VERSIONS[kind],
  recordedAt: "2026-09-30T10:00:00.000Z",
});

const current: ConsentStateDto = { terms: granted("terms"), privacy: granted("privacy"), marketing: null };

describe("consentToConfirm: which documents the user must accept in the flow", () => {
  it("asks for nothing when both are granted at the current versions", () => {
    expect(consentToConfirm(current)).toEqual([]);
  });

  it.each(["terms", "privacy"] as const)("asks for %s when its record is missing", (kind) => {
    expect(consentToConfirm({ ...current, [kind]: null })).toEqual([kind]);
  });

  it.each(["terms", "privacy"] as const)("asks for %s when the latest record is a withdrawal", (kind) => {
    expect(consentToConfirm({ ...current, [kind]: { ...granted(kind), granted: false } })).toEqual([kind]);
  });

  it.each(["terms", "privacy"] as const)("asks for %s when the recorded version is outdated", (kind) => {
    expect(consentToConfirm({ ...current, [kind]: { ...granted(kind), version: "2020-01-01" } })).toEqual([kind]);
  });

  it.each(["terms", "privacy"] as const)("asks for %s when the recorded version is fabricated", (kind) => {
    expect(consentToConfirm({ ...current, [kind]: { ...granted(kind), version: "v999-made-up" } })).toEqual([kind]);
  });

  it.each(["terms", "privacy"] as const)("asks for %s when the recorded version is empty", (kind) => {
    expect(consentToConfirm({ ...current, [kind]: { ...granted(kind), version: "" } })).toEqual([kind]);
  });

  it("asks for %s when granted is a truthy value that is not true", () => {
    const stringly = { ...granted("terms"), granted: "true" as unknown as boolean };
    expect(consentToConfirm({ ...current, terms: stringly })).toEqual(["terms"]);
  });

  it("asks for both when nothing is recorded", () => {
    expect(consentToConfirm({ terms: null, privacy: null, marketing: null })).toEqual(["terms", "privacy"]);
  });

  it("does not let granted marketing consent stand in for either document", () => {
    const marketing = { granted: true, version: CONSENT_VERSIONS.marketing, recordedAt: "2026-09-30T10:00:00.000Z" };
    expect(consentToConfirm({ terms: null, privacy: null, marketing })).toEqual(["terms", "privacy"]);
  });

  it("asks for both when the state itself is missing", () => {
    expect(consentToConfirm(null)).toEqual(["terms", "privacy"]);
    expect(consentToConfirm(undefined)).toEqual(["terms", "privacy"]);
  });
});

describe("buildOnboardingBody", () => {
  /** The versions a rendered onboarding page shows. */
  const versions = { terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy };
  const named = { termsVersion: CONSENT_VERSIONS.terms, privacyVersion: CONSENT_VERSIONS.privacy };

  it("names both versions when nothing needs confirming", () => {
    expect(buildOnboardingBody({ needed: [], ticked: { terms: false, privacy: false }, versions })).toEqual({
      ok: true,
      body: named,
    });
  });

  it("refuses until every needed box is ticked, naming each missing one", () => {
    expect(
      buildOnboardingBody({ needed: ["terms", "privacy"], ticked: { terms: false, privacy: false }, versions }),
    ).toEqual({
      ok: false,
      errors: {
        terms: "Agree to the Terms to continue.",
        privacy: "Agree to the Privacy notice to continue.",
      },
    });
    expect(
      buildOnboardingBody({ needed: ["terms", "privacy"], ticked: { terms: true, privacy: false }, versions }),
    ).toEqual({
      ok: false,
      errors: { privacy: "Agree to the Privacy notice to continue." },
    });
  });

  it("does not accept a ticked value that is not the boolean true", () => {
    const ticked = { terms: "on" as unknown as boolean, privacy: true };
    expect(buildOnboardingBody({ needed: ["terms"], ticked, versions })).toEqual({
      ok: false,
      errors: { terms: "Agree to the Terms to continue." },
    });
  });

  it("sends exactly the two fields the server accepts, as the versions shown", () => {
    const result = buildOnboardingBody({ needed: ["terms", "privacy"], ticked: { terms: true, privacy: true }, versions });
    expect(result).toEqual({ ok: true, body: named });
    if (result.ok) expect(Object.keys(result.body).sort()).toEqual(["privacyVersion", "termsVersion"]);
  });
});

describe("initialStep", () => {
  it("starts with the details until onboarding is complete", () => {
    expect(initialStep({ onboarded: false, profiles: 0 })).toBe("details");
  });

  it("goes straight to the first profile once onboarding is complete", () => {
    expect(initialStep({ onboarded: true, profiles: 0 })).toBe("profile");
  });

  it("has nothing left to do once a profile exists", () => {
    expect(initialStep({ onboarded: true, profiles: 1 })).toBe("done");
  });

  it("still starts with the details when a profile exists but onboarding is not complete", () => {
    expect(initialStep({ onboarded: false, profiles: 2 })).toBe("details");
  });
});

describe("review hour options", () => {
  it("offers every hour of the day once, from 0 to 23", () => {
    expect(REVIEW_HOUR_OPTIONS.map((option) => option.value)).toEqual(
      Array.from({ length: 24 }, (_, hour) => String(hour)),
    );
  });

  it("labels the hours on a 24 hour clock", () => {
    expect(REVIEW_HOUR_OPTIONS[0]?.label).toBe("00:00");
    expect(REVIEW_HOUR_OPTIONS[9]?.label).toBe("09:00");
    expect(REVIEW_HOUR_OPTIONS[23]?.label).toBe("23:00");
  });
});

describe("validateDetails", () => {
  const ok = { name: "Atlas", timezone: "Europe/Berlin", reviewHour: "9" };

  it("accepts a name, a known timezone, and an hour from 0 to 23", () => {
    expect(validateDetails(ok)).toEqual({ ok: true, body: { name: "Atlas", timezone: "Europe/Berlin", reviewHour: 9 } });
  });

  it("sends the review hour as a number", () => {
    const result = validateDetails({ ...ok, reviewHour: "0" });
    expect(result).toEqual({ ok: true, body: { name: "Atlas", timezone: "Europe/Berlin", reviewHour: 0 } });
  });

  it("names each field that is not valid", () => {
    expect(validateDetails({ name: " ", timezone: "Mars/Olympus", reviewHour: "24" })).toEqual({
      ok: false,
      errors: {
        name: "Enter the name to show in the app.",
        timezone: "Choose a timezone from the list.",
        reviewHour: "Choose an hour from the list.",
      },
    });
    expect(validateDetails({ ...ok, reviewHour: "9.5" })).toMatchObject({ ok: false });
    expect(validateDetails({ ...ok, reviewHour: "" })).toMatchObject({ ok: false });
  });
});

describe("describeApiFailure", () => {
  it("shows the message of the error envelope", () => {
    const body = JSON.stringify({ error: { code: "conflict", message: "You have already added that profile." } });
    expect(describeApiFailure(409, body)).toEqual({
      status: 409,
      code: "conflict",
      message: "You have already added that profile.",
      fields: [],
    });
  });

  it("returns the fields the server named", () => {
    const body = JSON.stringify({
      error: { code: "invalid_input", message: "Some fields are missing or not valid.", details: { fields: ["timezone"] } },
    });
    expect(describeApiFailure(422, body).fields).toEqual(["timezone"]);
  });

  it("says plainly when the route does not exist yet", () => {
    expect(describeApiFailure(404, "<!DOCTYPE html><html>not found</html>")).toEqual({
      status: 404,
      code: "unknown",
      message: "The server could not handle this request (status 404). Try again shortly.",
      fields: [],
    });
  });

  it("does not show markup or an oversized message", () => {
    expect(describeApiFailure(500, "<html>stack trace</html>").message).not.toContain("<");
    const long = JSON.stringify({ error: { code: "internal", message: "x".repeat(5000) } });
    expect(describeApiFailure(500, long).message.length).toBeLessThanOrEqual(300);
  });

  it("handles an empty body and a body that is not an envelope", () => {
    expect(describeApiFailure(503, "").code).toBe("unknown");
    expect(describeApiFailure(400, JSON.stringify({ message: "no envelope" })).code).toBe("unknown");
    expect(describeApiFailure(400, JSON.stringify({ error: "text" })).code).toBe("unknown");
  });

  it("ignores field names that are not strings", () => {
    const body = JSON.stringify({ error: { code: "invalid_input", message: "Bad.", details: { fields: ["name", 7, null] } } });
    expect(describeApiFailure(422, body).fields).toEqual(["name"]);
  });
});
