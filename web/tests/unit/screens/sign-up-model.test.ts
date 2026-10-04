import { describe, expect, it } from "vitest";

import { passwordStrength } from "@/components/auth/password-strength";
import {
  buildSignUpRequest,
  PASSWORD_MAX,
  PASSWORD_MIN,
  validateEmail,
  validateNewPassword,
  validateSignUp,
  VERIFY_CALLBACK_PATH,
  type SignUpValues,
} from "@/components/auth/sign-up-model";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { safeNextPath } from "@/server/auth/paths";

const valid: SignUpValues = {
  name: "Atlas Tester",
  email: "atlas@orbitdiff.test",
  password: "orbit-test-pw-1",
  timezone: "Europe/Berlin",
  acceptTerms: true,
  marketing: false,
  accessCode: "",
};

/** The versions a rendered sign-up page shows. */
const SHOWN = { terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy };
const ANY = { terms: "v", privacy: "v" };

const check = (overrides: Partial<SignUpValues>, accessCodeRequired = false) =>
  validateSignUp({ ...valid, ...overrides }, { accessCodeRequired });

describe("validateSignUp", () => {
  it("accepts a complete form", () => {
    expect(check({})).toEqual({});
  });

  it("requires a minimum password length of 10", () => {
    expect(PASSWORD_MIN).toBe(10);
    expect(check({ password: "ninechars" }).password).toBe("Use at least 10 characters.");
    expect(check({ password: "tencharsok" }).password).toBeUndefined();
  });

  it("refuses a password above the length the server accepts", () => {
    expect(PASSWORD_MAX).toBe(128);
    expect(check({ password: "a".repeat(129) }).password).toBe("Use at most 128 characters.");
    expect(check({ password: "a".repeat(128) }).password).toBeUndefined();
  });

  it("requires the display name, because the server rejects a blank one", () => {
    expect(check({ name: "   " }).name).toBe("Enter the name to show in the app.");
    expect(check({ name: "a".repeat(101) }).name).toBe("Use at most 100 characters.");
  });

  it("requires an email address of a plausible shape", () => {
    expect(check({ email: "" }).email).toBe("Enter your email address.");
    expect(check({ email: "atlas" }).email).toBe("Enter an email address such as name@example.com.");
    expect(check({ email: "atlas@orbitdiff" }).email).toBe("Enter an email address such as name@example.com.");
    expect(check({ email: `${"a".repeat(250)}@orbitdiff.test` }).email).toBe("Use at most 254 characters.");
  });

  it("requires a timezone the runtime knows", () => {
    expect(check({ timezone: "Mars/Olympus" }).timezone).toBe("Choose a timezone from the list.");
    expect(check({ timezone: "" }).timezone).toBe("Choose a timezone from the list.");
  });

  it("requires agreement to the Terms and the Privacy notice", () => {
    expect(check({ acceptTerms: false }).acceptTerms).toBe(
      "Agree to the Terms and the Privacy notice to create an account.",
    );
  });

  it("does not let the product news box stand in for the agreement", () => {
    expect(check({ acceptTerms: false, marketing: true }).acceptTerms).toBeDefined();
  });

  it("never requires the product news box", () => {
    expect(check({ marketing: false })).toEqual({});
    expect(check({ marketing: true })).toEqual({});
  });

  it("requires the access code only when registration needs one", () => {
    expect(check({ accessCode: "" }, true).accessCode).toBe("Enter the access code you were given.");
    expect(check({ accessCode: "orbit-preview-1" }, true).accessCode).toBeUndefined();
    expect(check({ accessCode: "" }, false).accessCode).toBeUndefined();
  });
});

describe("buildSignUpRequest", () => {
  it("sends the accepted versions, the timezone, and marketing as a boolean", () => {
    const request = buildSignUpRequest(valid, SHOWN);
    expect(request.body).toEqual({
      name: "Atlas Tester",
      email: "atlas@orbitdiff.test",
      password: "orbit-test-pw-1",
      timezone: "Europe/Berlin",
      acceptedTermsVersion: CONSENT_VERSIONS.terms,
      acceptedPrivacyVersion: CONSENT_VERSIONS.privacy,
      marketingOptIn: false,
      callbackURL: VERIFY_CALLBACK_PATH,
    });
    expect(request.headers).toEqual({});
  });

  it("sends marketingOptIn true only when the product news box is ticked", () => {
    expect(buildSignUpRequest({ ...valid, marketing: true }, ANY).body.marketingOptIn).toBe(true);
    expect(buildSignUpRequest({ ...valid, marketing: false }, ANY).body.marketingOptIn).toBe(false);
    const stringly = { ...valid, marketing: "on" as unknown as boolean };
    expect(buildSignUpRequest(stringly, ANY).body.marketingOptIn).toBe(false);
  });

  it("leaves acceptedTermsVersion out unless the agreement box is ticked", () => {
    const request = buildSignUpRequest({ ...valid, acceptTerms: false, marketing: true }, SHOWN);
    expect(Object.hasOwn(request.body, "acceptedTermsVersion")).toBe(false);
    const stringly = { ...valid, acceptTerms: "on" as unknown as boolean };
    expect(Object.hasOwn(buildSignUpRequest(stringly, ANY).body, "acceptedTermsVersion")).toBe(false);
  });

  it("trims the name and the email, and never the password", () => {
    const request = buildSignUpRequest(
      { ...valid, name: "  Atlas  ", email: " atlas@orbitdiff.test ", password: " spaced password " },
      ANY,
    );
    expect(request.body).toMatchObject({ name: "Atlas", email: "atlas@orbitdiff.test", password: " spaced password " });
  });

  it("sends the access code as a header, and only when one was entered", () => {
    expect(buildSignUpRequest({ ...valid, accessCode: " orbit-preview-1 " }, ANY).headers).toEqual({
      "x-signup-code": "orbit-preview-1",
    });
    expect(buildSignUpRequest({ ...valid, accessCode: "   " }, ANY).headers).toEqual({});
  });

  it("sends a callback that is a path on this site", () => {
    expect(safeNextPath(VERIFY_CALLBACK_PATH)).toBe(VERIFY_CALLBACK_PATH);
    expect(VERIFY_CALLBACK_PATH.startsWith("/verify-email")).toBe(true);
  });

  it("sends nothing the server does not accept at sign-up", () => {
    const allowed = [
      "name",
      "email",
      "password",
      "timezone",
      "acceptedTermsVersion",
      "acceptedPrivacyVersion",
      "marketingOptIn",
      "callbackURL",
    ];
    for (const key of Object.keys(buildSignUpRequest({ ...valid, marketing: true, accessCode: "code" }, ANY).body)) {
      expect(allowed).toContain(key);
    }
  });
});

describe("validateEmail and validateNewPassword", () => {
  it("share the sign-up rules", () => {
    expect(validateEmail("atlas@orbitdiff.test")).toBeUndefined();
    expect(validateEmail("")).toBe("Enter your email address.");
    expect(validateNewPassword("tencharsok")).toBeUndefined();
    expect(validateNewPassword("short")).toBe("Use at least 10 characters.");
  });
});

describe("passwordStrength", () => {
  it("says a password under 10 characters is too short and how many are missing", () => {
    expect(passwordStrength("")).toMatchObject({ level: "empty" });
    expect(passwordStrength("abc")).toEqual({
      level: "too_short",
      label: "Too short",
      advice: "Add 7 more characters.",
    });
    expect(passwordStrength("ninechars").advice).toBe("Add 1 more character.");
  });

  it("calls a long password built from one repeated or sequential pattern weak", () => {
    expect(passwordStrength("aaaaaaaaaaaa").level).toBe("weak");
    expect(passwordStrength("1234567890").level).toBe("weak");
    expect(passwordStrength("passwordpassword").level).toBe("weak");
  });

  it("calls a password that repeats the email or the name weak", () => {
    expect(passwordStrength("atlas.studio.2026", { email: "atlas.studio@orbitdiff.test" }).level).toBe("weak");
    expect(passwordStrength("AtlasTester99", { name: "Atlas Tester" }).level).toBe("weak");
  });

  it("calls ten ordinary characters fair", () => {
    expect(passwordStrength("harbor-lamp").level).toBe("fair");
  });

  it("calls a long passphrase strong", () => {
    expect(passwordStrength("copper lantern orbit meadow").level).toBe("strong");
    expect(passwordStrength("T7#mq-Vd2!xLp9wz").level).toBe("strong");
  });

  it("always states the level in words and gives advice unless it is strong", () => {
    for (const password of ["abc", "aaaaaaaaaaaa", "harbor-lamp", "copper lantern orbit meadow"]) {
      const result = passwordStrength(password);
      expect(result.label.length).toBeGreaterThan(0);
      if (result.level !== "strong") expect(result.advice.length).toBeGreaterThan(0);
    }
  });

  it("never asks for a particular symbol or digit", () => {
    for (const password of ["abc", "aaaaaaaaaaaa", "harbor-lamp"]) {
      expect(passwordStrength(password).advice).not.toMatch(/symbol|digit|uppercase|number/i);
    }
  });
});
