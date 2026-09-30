import "server-only";

import { APIError, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { isValidTimezone } from "@/domain/schedule";
import { getEnv } from "@/server/env";
import { constantTimeEqual } from "@/server/http/compare";
import { mailDelivery } from "@/server/mail/transport";

import { ADDRESS_RULES, consumeAddressLimit } from "./address-limit";
import { recordAuthEvent } from "./audit";
import { isRecord, type Body, type GateContext } from "./gate-context";
import { isSitePath, SITE_PATH_MAX } from "./paths";
import { discardPendingAccount } from "./pending";
import { getRegistrationState } from "./registration";
import { SIGNUP_CODE_HEADER } from "./signup-code";
import { refuseSuspendedLogin } from "./suspension";
import { completeVerification, openVerificationLink } from "./verification";

const NAME_MAX = 100;
const EMAIL_MAX = 254;

/** The only body keys each endpoint accepts. Everything else is refused, never ignored. */
const SIGN_UP_KEYS = new Set([
  "name",
  "email",
  "password",
  "timezone",
  "acceptedTermsVersion",
  "acceptedPrivacyVersion",
  "marketingOptIn",
  "callbackURL",
  "rememberMe",
]);
const UPDATE_USER_KEYS = new Set(["name", "timezone"]);
const DELETE_USER_KEYS = new Set(["password", "callbackURL"]);

/** Body and query fields that name where the person is sent next, with the error code for each. */
const REDIRECT_FIELDS = {
  callbackURL: "INVALID_CALLBACK_URL",
  redirectTo: "INVALID_REDIRECT_URL",
  errorCallbackURL: "INVALID_CALLBACK_URL",
  newUserCallbackURL: "INVALID_CALLBACK_URL",
} as const;

/**
 * A redirect target must be a path on this site of bounded length. Better Auth
 * accepts any trusted-origin URL of any size and copies it into the mail it
 * sends, so without this one request could store a megabyte.
 *
 * "On this site" is judged after the value is resolved the way a browser
 * resolves it (isSitePath), not by its first characters: "/.//host" starts with
 * one slash and still leads to another host.
 */
function assertAppPaths(source: unknown): void {
  if (!isRecord(source)) return;
  for (const [field, code] of Object.entries(REDIRECT_FIELDS)) {
    if (!Object.hasOwn(source, field)) continue;
    if (!isSitePath(source[field])) {
      throw new APIError("UNPROCESSABLE_ENTITY", {
        code,
        message: `Use a path on this site of at most ${SITE_PATH_MAX} characters for ${field}.`,
      });
    }
  }
}

function asBody(value: unknown): Body {
  if (!isRecord(value)) {
    throw new APIError("BAD_REQUEST", { code: "INVALID_BODY", message: "Send the fields as an object." });
  }
  return value;
}

/**
 * Reject any key outside the allowlist. The message names at most five keys,
 * each cut to 40 characters, and never echoes a value.
 */
function assertOnlyKeys(body: Body, allowed: ReadonlySet<string>): void {
  const extra = Object.keys(body)
    .filter((key) => !allowed.has(key))
    .sort();
  if (extra.length > 0) {
    const named = extra.slice(0, 5).map((key) => key.slice(0, 40));
    throw new APIError("BAD_REQUEST", {
      code: "FIELD_NOT_ALLOWED",
      message: `These fields cannot be set here: ${named.join(", ")}.`,
    });
  }
}

function assertName(name: unknown): void {
  if (typeof name !== "string" || name.trim().length === 0 || name.length > NAME_MAX) {
    throw new APIError("UNPROCESSABLE_ENTITY", {
      code: "INVALID_NAME",
      message: `Enter a name of 1 to ${NAME_MAX} characters.`,
    });
  }
}

function assertTimeZone(timezone: unknown): void {
  if (!isValidTimezone(timezone)) {
    throw new APIError("UNPROCESSABLE_ENTITY", {
      code: "INVALID_TIMEZONE",
      message: "Choose a valid IANA timezone, for example Europe/Berlin.",
    });
  }
}

const ACCEPT_TO_REGISTER = "Accept the Terms and the Privacy notice to create an account.";

function termsNotAccepted(message: string): APIError {
  return new APIError("UNPROCESSABLE_ENTITY", { code: "TERMS_NOT_ACCEPTED", message });
}

/**
 * Consent gate. It passes for exactly one value: the current version of the
 * Terms, as a string, compared in full. Each other state is refused with a
 * message that names what is wrong, and no message echoes what was sent.
 *
 * A marketing choice never stands in for it. It is a separate field, recorded
 * as a separate row (see recordSignupConsent). The Privacy notice has its own
 * check, assertPrivacyAccepted.
 */
function assertTermsAccepted(body: Body): void {
  const value = Object.hasOwn(body, "acceptedTermsVersion") ? body.acceptedTermsVersion : undefined;
  if (value === undefined) {
    const marketingOnly = body.marketingOptIn !== undefined && body.marketingOptIn !== false;
    throw termsNotAccepted(
      marketingOnly
        ? `acceptedTermsVersion is missing. Agreeing to product news does not accept the Terms. ${ACCEPT_TO_REGISTER}`
        : `acceptedTermsVersion is missing. ${ACCEPT_TO_REGISTER}`,
    );
  }
  if (typeof value !== "string") {
    throw termsNotAccepted("acceptedTermsVersion must be text. Send the version of the Terms that was accepted.");
  }
  if (value.length === 0) {
    throw termsNotAccepted(`acceptedTermsVersion is empty. ${ACCEPT_TO_REGISTER}`);
  }
  if (value !== CONSENT_VERSIONS.terms) {
    throw termsNotAccepted(
      `acceptedTermsVersion is not the current version of the Terms (${CONSENT_VERSIONS.terms}). ` +
        "Read and accept the current Terms to create an account.",
    );
  }
}

const RELOAD_FOR_PRIVACY =
  "Reload the page, read the current Privacy notice, and agree again to create an account.";

function privacyNotAccepted(message: string): APIError {
  return new APIError("UNPROCESSABLE_ENTITY", { code: "PRIVACY_NOT_ACCEPTED", message });
}

/**
 * Consent gate for the Privacy notice. Privacy consent is recorded at the
 * version the request named, so the request has to name the current one:
 *
 * - `acceptedPrivacyVersion`, when it is sent, must be the current version of
 *   the Privacy notice, as a string, compared in full;
 * - when it is not sent, the request named one version for both documents (the
 *   sign-up box covers both). That version stands for the Privacy notice only
 *   if it is exactly its current version too.
 *
 * So a page that was rendered before the Privacy notice changed cannot accept
 * the new text unread, whichever of the two it sends. No message repeats what
 * was sent, and a marketing choice never stands in for either document.
 */
function assertPrivacyAccepted(body: Body): void {
  if (!Object.hasOwn(body, "acceptedPrivacyVersion") || body.acceptedPrivacyVersion === undefined) {
    if (body.acceptedTermsVersion !== CONSENT_VERSIONS.privacy) {
      throw privacyNotAccepted(
        "acceptedPrivacyVersion is missing, and the version the request names is not the current version of the " +
          `Privacy notice. ${RELOAD_FOR_PRIVACY}`,
      );
    }
    return;
  }
  const value = body.acceptedPrivacyVersion;
  if (typeof value !== "string") {
    throw privacyNotAccepted(
      "acceptedPrivacyVersion must be text. Send the version of the Privacy notice that was accepted.",
    );
  }
  if (value.length === 0) {
    throw privacyNotAccepted(`acceptedPrivacyVersion is empty. ${ACCEPT_TO_REGISTER}`);
  }
  if (value !== CONSENT_VERSIONS.privacy) {
    throw privacyNotAccepted(
      `acceptedPrivacyVersion is not the current version of the Privacy notice. ${RELOAD_FOR_PRIVACY}`,
    );
  }
}

/** What the gate hands back to Better Auth: the one body field it rewrites. */
interface SignUpRewrite {
  context: { body: { marketingOptIn: boolean } };
}

/**
 * Registration gate. Order matters: a closed or paused deployment says so
 * before anything else is checked (the operator rule first, inside
 * getRegistrationState), then the access code, then the body.
 *
 * Marketing consent is granted by the boolean `true` and by nothing else. Any
 * other value ("true", "on", 1, a missing field) is replaced with `false`
 * before Better Auth reads the body, so no coercion further down can turn it
 * into a grant.
 */
async function gateSignUp(ctx: GateContext): Promise<SignUpRewrite> {
  const rawBody: unknown = ctx.body;
  const headers = ctx.headers;
  const env = getEnv();
  const state = await getRegistrationState(env);
  if (!state.open) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: state.code === "closed" ? "REGISTRATION_CLOSED" : "REGISTRATION_PAUSED",
      message: state.reason ?? "Registration is not open.",
    });
  }
  if (
    env.signupAccessCode !== null &&
    !constantTimeEqual(headers?.get(SIGNUP_CODE_HEADER) ?? "", env.signupAccessCode)
  ) {
    throw new APIError("FORBIDDEN", {
      code: "ACCESS_CODE_REQUIRED",
      message: "A valid access code is required to register.",
    });
  }
  const body = asBody(rawBody);
  assertOnlyKeys(body, SIGN_UP_KEYS);
  assertTermsAccepted(body);
  assertPrivacyAccepted(body);
  assertTimeZone(body.timezone);
  assertName(body.name);
  if (typeof body.email !== "string" || body.email.length > EMAIL_MAX) {
    throw new APIError("UNPROCESSABLE_ENTITY", { code: "INVALID_EMAIL", message: "Enter a valid email address." });
  }
  if (wouldBeAccepted(ctx, body)) await discardPendingAccount(body.email);
  return { context: { body: { marketingOptIn: body.marketingOptIn === true } } };
}

/**
 * Run the registration gate and leave an audit row for every refusal it
 * raises: the action and the refusal code, nothing about the person. The
 * refusal is rethrown whether or not the row could be written.
 */
async function gateSignUpAudited(ctx: GateContext): Promise<SignUpRewrite> {
  try {
    return await gateSignUp(ctx);
  } catch (error) {
    if (error instanceof APIError) {
      const code = (error.body as { code?: unknown } | undefined)?.code;
      await recordAuthEvent("registration_refused", { code: typeof code === "string" ? code : "UNKNOWN" });
    }
    throw error;
  }
}

/**
 * True when Better Auth will accept this registration, judged by the checks it
 * runs after this gate: the email shape, the password length, and the type of
 * rememberMe. A pending account is only replaced by a registration that will
 * go through, never by a request that is about to be refused.
 */
function wouldBeAccepted(ctx: GateContext, body: Body): body is Body & { email: string } {
  const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
  const { email, password, rememberMe } = body;
  return (
    z.email().safeParse(email).success &&
    typeof password === "string" &&
    password.length >= minPasswordLength &&
    password.length <= maxPasswordLength &&
    (rememberMe === undefined || typeof rememberMe === "boolean")
  );
}

/**
 * Only the display name and the timezone can change through Better Auth.
 * Consent changes must go through the consent log, and review settings,
 * status, and verification are never client-settable.
 */
function gateUpdateUser(rawBody: unknown): void {
  const body = asBody(rawBody);
  assertOnlyKeys(body, UPDATE_USER_KEYS);
  if (body.name !== undefined) assertName(body.name);
  if (body.timezone !== undefined) assertTimeZone(body.timezone);
}

/**
 * Account deletion always needs the password. Better Auth alone would accept a
 * request without one from any session younger than a day.
 */
function gateDeleteUser(rawBody: unknown): void {
  const body = asBody(rawBody ?? {});
  assertOnlyKeys(body, DELETE_USER_KEYS);
  if (typeof body.password !== "string" || body.password.length === 0) {
    throw new APIError("BAD_REQUEST", {
      code: "PASSWORD_REQUIRED",
      message: "Enter your password to delete your account.",
    });
  }
}

/** Do not pretend a message was sent when nothing can be delivered. */
function gateMail(): void {
  if (!mailDelivery(getEnv()).available) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "EMAIL_UNAVAILABLE",
      message: "Email delivery is not configured, so this message cannot be sent.",
    });
  }
}

/**
 * The second rate limit: per target address, whatever client the request comes
 * from. It follows the same switch as Better Auth's own limiter and answers the
 * same way (429 with X-Retry-After).
 */
async function limitPerAddress(ctx: GateContext): Promise<void> {
  const rule = ADDRESS_RULES[ctx.path];
  if (!rule || !ctx.context.rateLimit.enabled || !isRecord(ctx.body)) return;
  const { email } = ctx.body;
  if (typeof email !== "string" || email.length > EMAIL_MAX || !z.email().safeParse(email).success) return;
  const decision = await consumeAddressLimit(ctx.path, email, rule);
  if (!decision.allowed) {
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { message: "Too many requests. Please try again later." },
      { "X-Retry-After": String(decision.retryAfter) },
    );
  }
}

/**
 * Better Auth `hooks.before`. It runs inside the request pipeline, after the
 * built-in rate limiter, for HTTP requests and for server-side auth.api calls alike.
 *
 * Order: redirect targets are checked, then the per-address limit is counted,
 * then a suspended login is refused, then the endpoint's own rules apply.
 */
export const authGate = createAuthMiddleware(async (ctx) => {
  assertAppPaths(ctx.body);
  assertAppPaths(ctx.query);
  await limitPerAddress(ctx);
  await refuseSuspendedLogin(ctx);
  switch (ctx.path) {
    case "/sign-up/email":
      return gateSignUpAudited(ctx);
    case "/sign-in/email":
      await completeVerification(ctx);
      return;
    case "/verify-email":
      return openVerificationLink(ctx);
    case "/update-user":
      gateUpdateUser(ctx.body);
      return;
    case "/delete-user":
      gateDeleteUser(ctx.body);
      return;
    case "/request-password-reset":
    case "/send-verification-email":
      gateMail();
      return;
    default:
      return;
  }
});
