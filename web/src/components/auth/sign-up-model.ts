import { isValidTimezone } from "@/domain/schedule";
import { SIGNUP_CODE_HEADER } from "@/server/auth/signup-code";

/**
 * The rules of the sign-up form, as pure functions. They mirror what the server
 * enforces so a mistake is shown next to its field before anything is sent. The
 * server stays the authority: it checks every one of these again.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;

/** Where the confirmation link returns to. A path on this site, as the server requires. */
export const VERIFY_CALLBACK_PATH = "/verify-email?step=opened";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignUpValues {
  name: string;
  email: string;
  password: string;
  timezone: string;
  /** The required box: agreement to the Terms and the Privacy notice. */
  acceptTerms: boolean;
  /** The optional box: product news by email. Never pre-ticked. */
  marketing: boolean;
  accessCode: string;
}

export type SignUpField = "name" | "email" | "password" | "timezone" | "acceptTerms" | "accessCode";
export type SignUpErrors = Partial<Record<SignUpField, string>>;

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (email.length === 0) return "Enter your email address.";
  if (email.length > EMAIL_MAX) return `Use at most ${EMAIL_MAX} characters.`;
  if (!EMAIL_SHAPE.test(email)) return "Enter an email address such as name@example.com.";
  return undefined;
}

export function validateNewPassword(value: string): string | undefined {
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (value.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return undefined;
}

export function validateName(value: string): string | undefined {
  if (value.trim().length === 0) return "Enter the name to show in the app.";
  if (value.length > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
  return undefined;
}

export function validateTimezone(value: string): string | undefined {
  return isValidTimezone(value) ? undefined : "Choose a timezone from the list.";
}

/** Field errors for the whole form. An empty object means it can be sent. */
export function validateSignUp(values: SignUpValues, options: { accessCodeRequired: boolean }): SignUpErrors {
  const errors: SignUpErrors = {};
  const set = (field: SignUpField, message: string | undefined) => {
    if (message !== undefined) errors[field] = message;
  };
  set("name", validateName(values.name));
  set("email", validateEmail(values.email));
  set("password", validateNewPassword(values.password));
  set("timezone", validateTimezone(values.timezone));
  // Only the agreement box itself counts. The product news box is a separate choice.
  if (values.acceptTerms !== true) {
    set("acceptTerms", "Agree to the Terms and the Privacy notice to create an account.");
  }
  if (options.accessCodeRequired && values.accessCode.trim().length === 0) {
    set("accessCode", "Enter the access code you were given.");
  }
  return errors;
}

/** The version of each document a page showed next to its agreement box. */
export interface DocumentVersions {
  terms: string;
  privacy: string;
}

export interface SignUpRequest {
  body: {
    name: string;
    email: string;
    password: string;
    timezone: string;
    acceptedTermsVersion?: string;
    acceptedPrivacyVersion?: string;
    marketingOptIn: boolean;
    callbackURL: string;
  };
  headers: Record<string, string>;
}

/**
 * What the form sends. Three rules matter here:
 * - `acceptedTermsVersion` and `acceptedPrivacyVersion` are present only when
 *   the agreement box is ticked, so an unticked box can never be sent as an
 *   acceptance;
 * - each one is the version the page showed (`shown`), never a value looked up
 *   at the moment of sending. The server records consent at the version that
 *   was named and refuses a version that is no longer current, so a page that
 *   was open while a document changed cannot accept the new text unread;
 * - `marketingOptIn` is a boolean, true only when the product news box is ticked.
 */
export function buildSignUpRequest(values: SignUpValues, shown: DocumentVersions): SignUpRequest {
  const body: SignUpRequest["body"] = {
    name: values.name.trim(),
    email: values.email.trim(),
    password: values.password,
    timezone: values.timezone,
    marketingOptIn: values.marketing === true,
    callbackURL: VERIFY_CALLBACK_PATH,
  };
  if (values.acceptTerms === true) {
    body.acceptedTermsVersion = shown.terms;
    body.acceptedPrivacyVersion = shown.privacy;
  }
  const code = values.accessCode.trim();
  return { body, headers: code.length > 0 ? { [SIGNUP_CODE_HEADER]: code } : {} };
}
