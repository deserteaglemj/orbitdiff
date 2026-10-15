import { describe, expect, it } from "vitest";

import { describeAuthError, verifyPageState } from "@/components/auth/auth-errors";

describe("describeAuthError", () => {
  it("shows the server's reason when registration is closed or paused", () => {
    const reason = "Registration is closed: the operator of this service has not been named yet.";
    expect(describeAuthError({ status: 503, code: "REGISTRATION_CLOSED", message: reason })).toEqual({
      kind: "closed",
      message: reason,
    });
    expect(
      describeAuthError({ status: 503, code: "REGISTRATION_PAUSED", message: "Registration is paused: capacity reached." }),
    ).toEqual({ kind: "closed", message: "Registration is paused: capacity reached." });
  });

  it("ties a refused access code to the access code field", () => {
    expect(describeAuthError({ status: 403, code: "ACCESS_CODE_REQUIRED", message: "A valid access code is required to register." })).toEqual({
      kind: "field",
      field: "accessCode",
      message: "That access code is not valid. Check it and try again.",
    });
  });

  it("ties a terms refusal to the agreement box, in plain words", () => {
    const result = describeAuthError({
      status: 422,
      code: "TERMS_NOT_ACCEPTED",
      message: "acceptedTermsVersion is not the current version of the Terms (2026-09-30).",
    });
    expect(result).toEqual({
      kind: "field",
      field: "acceptTerms",
      message:
        "The Terms were not accepted at their current version. Reload this page, read the current Terms, and agree again.",
    });
    expect(result.message).not.toContain("acceptedTermsVersion");
  });

  it.each([
    ["INVALID_TIMEZONE", "timezone"],
    ["INVALID_NAME", "name"],
    ["INVALID_EMAIL", "email"],
    ["PASSWORD_TOO_SHORT", "password"],
    ["PASSWORD_TOO_LONG", "password"],
  ])("ties %s to the %s field and shows the server's message", (code, field) => {
    expect(describeAuthError({ status: 422, code, message: "Server wording." })).toEqual({
      kind: "field",
      field,
      message: "Server wording.",
    });
  });

  it("explains an unverified address without claiming that mail was sent", () => {
    const result = describeAuthError({ status: 403, code: "EMAIL_NOT_VERIFIED", message: "Email not verified" });
    expect(result.kind).toBe("unverified");
    expect(result.message).toBe(
      "This address is not confirmed yet. Open the link from the confirmation message in this browser, then sign in here again.",
    );
    expect(result.message).not.toMatch(/sent|inbox/i);
  });

  it("recognizes a suspended account", () => {
    expect(describeAuthError({ status: 403, code: "ACCOUNT_SUSPENDED", message: "This account is suspended." })).toEqual({
      kind: "suspended",
      message: "This account is suspended.",
    });
  });

  it("does not say which of the email and the password was wrong", () => {
    expect(describeAuthError({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" })).toEqual({
      kind: "form",
      message: "The email address or the password is not right.",
    });
  });

  it("asks the visitor to wait when there were too many requests", () => {
    expect(describeAuthError({ status: 429, message: "Too many requests. Please try again later." })).toEqual({
      kind: "rate_limited",
      message: "Too many attempts. Wait a minute, then try again.",
    });
  });

  it("explains a reset link that is not valid", () => {
    expect(describeAuthError({ status: 400, code: "INVALID_TOKEN", message: "invalid token" })).toEqual({
      kind: "invalid_token",
      message: "This link is not valid or has expired. Request a new one.",
    });
  });

  it("shows the server's message when mail cannot be handled", () => {
    const message = "Email delivery is not configured, so this message cannot be sent.";
    expect(describeAuthError({ status: 503, code: "EMAIL_UNAVAILABLE", message })).toEqual({ kind: "form", message });
  });

  it("shows the server's message for a code it does not know", () => {
    expect(describeAuthError({ status: 400, code: "FIELD_NOT_ALLOWED", message: "These fields cannot be set here: role." })).toEqual({
      kind: "form",
      message: "These fields cannot be set here: role.",
    });
  });

  it("reads the message of the application error envelope", () => {
    expect(
      describeAuthError({ status: 422, error: { code: "invalid_input", message: "The request body is too large." } }),
    ).toEqual({ kind: "form", message: "The request body is too large." });
  });

  it("falls back to a plain sentence when there is nothing to show", () => {
    const fallback = { kind: "form", message: "Something went wrong. Try again shortly." };
    expect(describeAuthError({ status: 500 })).toEqual(fallback);
    expect(describeAuthError(null)).toEqual(fallback);
    expect(describeAuthError("boom")).toEqual(fallback);
    expect(describeAuthError({ status: 500, message: "" })).toEqual(fallback);
  });

  it("never shows a message longer than a few sentences", () => {
    const result = describeAuthError({ status: 400, code: "WHATEVER", message: "x".repeat(2000) });
    expect(result.message.length).toBeLessThanOrEqual(300);
  });
});

describe("verifyPageState", () => {
  it("is the waiting state with no parameters", () => {
    expect(verifyPageState({})).toBe("waiting");
  });

  it("is the opened state when the link returned without an error", () => {
    expect(verifyPageState({ step: "opened" })).toBe("opened");
  });

  it("is the invalid state for a link that did not verify, whatever else is present", () => {
    expect(verifyPageState({ error: "INVALID_TOKEN" })).toBe("invalid");
    expect(verifyPageState({ step: "opened", error: "INVALID_TOKEN" })).toBe("invalid");
    expect(verifyPageState({ step: "opened", error: "USER_NOT_FOUND" })).toBe("invalid");
    expect(verifyPageState({ error: "anything-else" })).toBe("invalid");
  });

  it("ignores values that are not single strings", () => {
    expect(verifyPageState({ step: ["opened", "opened"] })).toBe("waiting");
    expect(verifyPageState({ step: "something" })).toBe("waiting");
  });
});
