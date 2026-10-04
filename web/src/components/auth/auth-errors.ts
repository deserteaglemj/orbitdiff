import type { SignUpField } from "./sign-up-model";

/**
 * Turn a failed account request into what the screen shows. Better Auth answers
 * `{ code, message }`; the guarded entry point in front of it answers the
 * application envelope `{ error: { code, message } }`. Both are read here.
 */
export type AuthFailure =
  | { kind: "field"; field: SignUpField; message: string }
  /** Registration is closed or paused: the form is replaced by the reason. */
  | { kind: "closed"; message: string }
  /** The address is not confirmed yet: the screen offers a new confirmation message. */
  | { kind: "unverified"; message: string }
  | { kind: "suspended"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "invalid_token"; message: string }
  | { kind: "form"; message: string };

const FALLBACK = "Something went wrong. Try again shortly.";
const MESSAGE_MAX = 300;

const FIELD_CODES: Record<string, SignUpField> = {
  INVALID_TIMEZONE: "timezone",
  INVALID_NAME: "name",
  INVALID_EMAIL: "email",
  PASSWORD_TOO_SHORT: "password",
  PASSWORD_TOO_LONG: "password",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, MESSAGE_MAX) : null;
}

export function describeAuthError(error: unknown): AuthFailure {
  if (!isRecord(error)) return { kind: "form", message: FALLBACK };
  const envelope = isRecord(error.error) ? error.error : null;
  const code = text(error.code) ?? text(envelope?.code) ?? "";
  const message = text(error.message) ?? text(envelope?.message) ?? FALLBACK;

  if (error.status === 429) {
    return { kind: "rate_limited", message: "Too many attempts. Wait a minute, then try again." };
  }
  switch (code) {
    case "REGISTRATION_CLOSED":
    case "REGISTRATION_PAUSED":
      return { kind: "closed", message };
    case "ACCESS_CODE_REQUIRED":
      return { kind: "field", field: "accessCode", message: "That access code is not valid. Check it and try again." };
    case "TERMS_NOT_ACCEPTED":
      return {
        kind: "field",
        field: "acceptTerms",
        message:
          "The Terms were not accepted at their current version. Reload this page, read the current Terms, and agree again.",
      };
    case "PRIVACY_NOT_ACCEPTED":
      return {
        kind: "field",
        field: "acceptTerms",
        message:
          "The Privacy notice was not accepted at its current version. Reload this page, read the current Privacy notice, and agree again.",
      };
    case "EMAIL_NOT_VERIFIED":
      return {
        kind: "unverified",
        message:
          "This address is not confirmed yet. Open the link from the confirmation message in this browser, then sign in here again.",
      };
    case "ACCOUNT_SUSPENDED":
      return { kind: "suspended", message: "This account is suspended." };
    case "INVALID_EMAIL_OR_PASSWORD":
      return { kind: "form", message: "The email address or the password is not right." };
    case "INVALID_TOKEN":
      return { kind: "invalid_token", message: "This link is not valid or has expired. Request a new one." };
    default: {
      const field = Object.hasOwn(FIELD_CODES, code) ? FIELD_CODES[code] : undefined;
      return field ? { kind: "field", field, message } : { kind: "form", message };
    }
  }
}

export type VerifyPageState = "waiting" | "opened" | "invalid";

/**
 * Which state the verify page shows, from its query. The confirmation link
 * returns here with `step=opened`, and with `error=<code>` when it did not
 * work. Any error wins: a link that failed is never shown as opened.
 */
export function verifyPageState(query: { step?: unknown; error?: unknown }): VerifyPageState {
  if (query.error !== undefined) return "invalid";
  return query.step === "opened" ? "opened" : "waiting";
}
