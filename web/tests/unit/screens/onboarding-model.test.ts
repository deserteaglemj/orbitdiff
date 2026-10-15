import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { describeApiFailure } from "@/components/onboarding/api";
import {
  buildOnboardingBody,
  consentToConfirm,
  flowHeader,
  initialStep,
  isReturning,
  onboardingAccount,
  REVIEW_HOUR_OPTIONS,
  stepAfterAgreement,
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
  /** A first run: onboarding was never completed. */
  const firstRun = { completedBefore: false };
  /** Onboarding was completed at some point: onboarded_at is set. */
  const returning = { completedBefore: true };

  it("starts with the details until onboarding is complete", () => {
    expect(initialStep({ ...firstRun, onboarded: false, profiles: 0 })).toBe("details");
  });

  it("goes straight to the first profile once onboarding is complete", () => {
    expect(initialStep({ ...returning, onboarded: true, profiles: 0 })).toBe("profile");
  });

  it("has nothing left to do once a profile exists", () => {
    expect(initialStep({ ...returning, onboarded: true, profiles: 1 })).toBe("done");
  });

  it("still starts with the details when a profile exists but onboarding was never completed", () => {
    expect(initialStep({ ...firstRun, onboarded: false, profiles: 2 })).toBe("details");
  });

  it("starts a returning user whose consent went out of date at the agreement step, not at the details", () => {
    expect(initialStep({ ...returning, onboarded: false, profiles: 2 })).toBe("consent");
    expect(initialStep({ ...returning, onboarded: false, profiles: 3 })).toBe("consent");
  });

  it("starts a returning user without a profile at the agreement step as well", () => {
    expect(initialStep({ ...returning, onboarded: false, profiles: 0 })).toBe("consent");
  });

  it("treats anything but completedBefore true as a first run", () => {
    for (const completedBefore of [undefined, null, "true", 1]) {
      const account = { completedBefore: completedBefore as unknown as boolean, onboarded: false, profiles: 1 };
      expect(initialStep(account), String(completedBefore)).toBe("details");
    }
  });
});

describe("stepAfterAgreement", () => {
  it("is done for an account that already has profiles: it is not asked for a first profile again", () => {
    expect(stepAfterAgreement({ profiles: 1 })).toBe("done");
    expect(stepAfterAgreement({ profiles: 2 })).toBe("done");
  });

  it("is done for an account that holds the maximum of three profiles, which could not add another", () => {
    expect(stepAfterAgreement({ profiles: 3 })).toBe("done");
  });

  it("is the first profile for an account that has none", () => {
    expect(stepAfterAgreement({ profiles: 0 })).toBe("profile");
  });

  it("asks for a first profile when the count is not a positive whole number", () => {
    for (const profiles of [undefined, null, "2", Number.NaN, -1]) {
      expect(stepAfterAgreement({ profiles: profiles as unknown as number }), String(profiles)).toBe("profile");
    }
  });
});

describe("onboardingAccount: what the page hands to the flow", () => {
  const me = {
    id: "user-1",
    email: "atlas@orbitdiff.test",
    name: "Atlas",
    timezone: "Europe/Berlin",
    reviewHour: 7,
    onboarded: false,
    isAdmin: false,
    consent: current,
    usage: { profiles: 2, profilesLimit: 3, importsToday: 0, importsPerDayLimit: 10, rosterBytes: 0, rosterBytesLimit: 1 },
  };

  it("keeps the two facts apart: onboarded from the account, completedBefore from onboarded_at", () => {
    expect(onboardingAccount(me, new Date("2026-08-01T09:00:00.000Z"))).toEqual({
      name: "Atlas",
      timezone: "Europe/Berlin",
      reviewHour: 7,
      onboarded: false,
      completedBefore: true,
      profiles: 2,
      consent: current,
    });
  });

  it("reports a first run when onboarded_at was never set", () => {
    expect(onboardingAccount(me, null).completedBefore).toBe(false);
    expect(onboardingAccount(me, undefined).completedBefore).toBe(false);
  });

  it("does not take an invalid date for a completed onboarding", () => {
    expect(onboardingAccount(me, new Date("not a date")).completedBefore).toBe(false);
  });

  it("hands over nothing but what the flow shows", () => {
    expect(Object.keys(onboardingAccount(me, null)).sort()).toEqual(
      ["completedBefore", "consent", "name", "onboarded", "profiles", "reviewHour", "timezone"].sort(),
    );
  });
});

describe("flowHeader: which heading the page carries", () => {
  const returning = { completedBefore: true, onboarded: false };
  const firstRun = { completedBefore: false, onboarded: false };

  it("says to agree to the current documents while a returning user is at the agreement, and after it", () => {
    expect(flowHeader(returning, "consent")).toBe("agreement");
    expect(flowHeader(returning, "done")).toBe("agreement");
  });

  it("is the setup heading with its steps when a returning user without a profile reaches the first profile", () => {
    expect(flowHeader(returning, "profile")).toBe("setup");
  });

  it("is the setup heading on every step of a first run", () => {
    for (const step of ["details", "consent", "profile", "done"] as const) {
      expect(flowHeader(firstRun, step), step).toBe("setup");
    }
  });

  it("is the setup heading for an onboarded account that adds its first profile", () => {
    expect(flowHeader({ completedBefore: true, onboarded: true }, "profile")).toBe("setup");
  });
});

describe("the flow's wiring", () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../../../src/components/onboarding/onboarding-flow.tsx"),
    "utf8",
  );

  it("asks the model where to go after the agreement, never a fixed step", () => {
    expect(source).toContain("setStep(stepAfterAgreement(account))");
    expect(source).not.toContain('setStep("profile")');
  });

  it("starts where the model says", () => {
    expect(source).toContain("initialStep(account)");
  });
});

describe("returning after onboarding", () => {
  it("is true only for an account that completed onboarding before and is not onboarded now", () => {
    expect(isReturning({ completedBefore: true, onboarded: false })).toBe(true);
    expect(isReturning({ completedBefore: true, onboarded: true })).toBe(false);
    expect(isReturning({ completedBefore: false, onboarded: false })).toBe(false);
    expect(isReturning({ completedBefore: "true" as unknown as boolean, onboarded: false })).toBe(false);
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
