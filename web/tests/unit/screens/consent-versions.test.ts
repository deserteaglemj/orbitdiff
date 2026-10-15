import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { describeAuthError } from "@/components/auth/auth-errors";
import { buildSignUpRequest, type SignUpValues } from "@/components/auth/sign-up-model";
import { SignUpScreen } from "@/components/auth/sign-up-screen";
import { buildOnboardingBody, consentToConfirm, describeAgreementRefusal } from "@/components/onboarding/model";
import type { ConsentStateDto } from "@/server/services/contracts";

import { htmlToText } from "../components/support/render";

/** Versions no real document has, so a test cannot pass by reading the server's own list. */
const SHOWN = { terms: "2031-02-03", privacy: "2031-04-05" };

const valid: SignUpValues = {
  name: "Atlas Tester",
  email: "atlas@orbitdiff.test",
  password: "orbit-test-pw-1",
  timezone: "Europe/Berlin",
  acceptTerms: true,
  marketing: false,
  accessCode: "",
};

describe("the sign-up request names the version of each document the page showed", () => {
  it("names the Terms version and the Privacy notice version when the agreement box is ticked", () => {
    const { body } = buildSignUpRequest(valid, SHOWN);
    expect(body.acceptedTermsVersion).toBe("2031-02-03");
    expect(body.acceptedPrivacyVersion).toBe("2031-04-05");
  });

  it("names neither version unless the agreement box is ticked", () => {
    for (const acceptTerms of [false, "on" as unknown as boolean, 1 as unknown as boolean]) {
      const { body } = buildSignUpRequest({ ...valid, acceptTerms, marketing: true }, SHOWN);
      expect(Object.hasOwn(body, "acceptedTermsVersion")).toBe(false);
      expect(Object.hasOwn(body, "acceptedPrivacyVersion")).toBe(false);
    }
  });

  it("does not let the product news box name a version", () => {
    const { body } = buildSignUpRequest({ ...valid, acceptTerms: false, marketing: true }, SHOWN);
    expect(JSON.stringify(body)).not.toContain("2031");
  });
});

describe("the sign-up screen shows the version of each document it will name", () => {
  const html = renderToStaticMarkup(
    createElement(SignUpScreen, {
      registration: { configured: true, open: true, reason: null, accessCodeRequired: false, mailCaptured: false },
      termsVersion: SHOWN.terms,
      privacyVersion: SHOWN.privacy,
      timezones: ["UTC"],
    }),
  );

  it("prints both versions next to the agreement box", () => {
    const text = htmlToText(html);
    expect(text).toContain("Terms version 2031-02-03");
    expect(text).toContain("Privacy notice version 2031-04-05");
  });
});

describe("a refusal about the Privacy notice lands on the agreement box", () => {
  it("is explained in plain words, without the field name of the request", () => {
    const result = describeAuthError({
      status: 422,
      code: "PRIVACY_NOT_ACCEPTED",
      message: "acceptedPrivacyVersion is not the current version of the Privacy notice.",
    });
    expect(result).toEqual({
      kind: "field",
      field: "acceptTerms",
      message:
        "The Privacy notice was not accepted at its current version. Reload this page, read the current Privacy notice, and agree again.",
    });
    expect(result.message).not.toContain("acceptedPrivacyVersion");
  });
});

describe("the onboarding request names the versions the screen showed", () => {
  const ticked = { terms: true, privacy: true };

  it("sends the two versions it was rendered with, and no acceptance flag", () => {
    const result = buildOnboardingBody({ needed: ["terms", "privacy"], ticked, versions: SHOWN });
    expect(result).toEqual({ ok: true, body: { termsVersion: "2031-02-03", privacyVersion: "2031-04-05" } });
    if (result.ok) expect(Object.keys(result.body).sort()).toEqual(["privacyVersion", "termsVersion"]);
  });

  it("sends the same two versions when no box was shown", () => {
    const result = buildOnboardingBody({ needed: [], ticked: { terms: false, privacy: false }, versions: SHOWN });
    expect(result).toEqual({ ok: true, body: { termsVersion: "2031-02-03", privacyVersion: "2031-04-05" } });
  });

  it("sends no version while a box that was shown is not ticked", () => {
    const result = buildOnboardingBody({ needed: ["terms", "privacy"], ticked: { terms: true, privacy: false }, versions: SHOWN });
    expect(result).toEqual({ ok: false, errors: { privacy: "Agree to the Privacy notice to continue." } });
    expect(JSON.stringify(result)).not.toContain("2031");
  });

  it("never sends the acceptance flags of the earlier contract", () => {
    const result = buildOnboardingBody({ needed: [], ticked, versions: SHOWN });
    if (!result.ok) throw new Error("expected a body");
    expect(JSON.stringify(result.body)).not.toMatch(/acceptTerms|acceptPrivacy|true/);
  });
});

describe("a refused agreement step says which document changed", () => {
  const refusal = (fields: string[], message = "termsVersion is not the current version of the Terms.") => ({
    code: "invalid_input",
    fields,
    message,
  });

  it("names the Terms when the route refuses the version named for them", () => {
    expect(describeAgreementRefusal(refusal(["termsVersion"]))).toBe(
      "The Terms changed while this page was open. Reload this page, read the current Terms, and agree again.",
    );
  });

  it("names the Privacy notice when the route refuses the version named for it", () => {
    expect(describeAgreementRefusal(refusal(["privacyVersion"]))).toBe(
      "The Privacy notice changed while this page was open. Reload this page, read the current Privacy notice, and agree again.",
    );
  });

  it("names both documents when the route refuses both versions", () => {
    expect(describeAgreementRefusal(refusal(["privacyVersion", "termsVersion"]))).toBe(
      "The Terms and the Privacy notice changed while this page was open. Reload this page, read the current versions, and agree again.",
    );
  });

  it("never shows the field names of the request", () => {
    for (const fields of [["termsVersion"], ["privacyVersion"], ["privacyVersion", "termsVersion"]]) {
      expect(describeAgreementRefusal(refusal(fields))).not.toMatch(/termsVersion|privacyVersion/);
    }
  });

  it("shows the route's own message for any other refusal", () => {
    expect(describeAgreementRefusal({ code: "suspended", fields: [], message: "This account is suspended." })).toBe(
      "This account is suspended.",
    );
    expect(describeAgreementRefusal(refusal(["marketing"], "Only termsVersion and privacyVersion can be sent here."))).toBe(
      "Only termsVersion and privacyVersion can be sent here.",
    );
    expect(describeAgreementRefusal({ code: "conflict", fields: ["termsVersion"], message: "Route wording." })).toBe(
      "Route wording.",
    );
  });
});

describe("the onboarding screen decides which boxes to show from the versions it was rendered with", () => {
  const recorded = (version: string) => ({ granted: true, version, recordedAt: "2026-09-30T10:00:00.000Z" });
  const state: ConsentStateDto = { terms: recorded("2031-02-03"), privacy: recorded("2031-04-05"), marketing: null };

  it("shows no box when each record is at the version shown", () => {
    expect(consentToConfirm(state, SHOWN)).toEqual([]);
  });

  it("shows the box of a document whose record is at another version than the one shown", () => {
    expect(consentToConfirm(state, { ...SHOWN, privacy: "2031-06-07" })).toEqual(["privacy"]);
    expect(consentToConfirm(state, { ...SHOWN, terms: "2031-06-07" })).toEqual(["terms"]);
  });

  it("does not take the version of one document for the other", () => {
    expect(consentToConfirm(state, { terms: SHOWN.privacy, privacy: SHOWN.terms })).toEqual(["terms", "privacy"]);
  });
});
