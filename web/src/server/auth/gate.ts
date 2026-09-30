import "server-only";

import { APIError, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { getEnv } from "@/server/env";
import { constantTimeEqual } from "@/server/http/compare";
import { mailDelivery } from "@/server/mail/transport";

import { ADDRESS_RULES, consumeAddressLimit } from "./address-limit";
import { isRecord, type Body, type GateContext } from "./gate-context";
import { discardPendingAccount } from "./pending";
import { getRegistrationState } from "./registration";
import { SIGNUP_CODE_HEADER } from "./signup-code";
import { refuseSuspendedLogin } from "./suspension";
import { isValidTimeZone } from "./timezone";
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
  "marketingOptIn",
  "callbackURL",
  "rememberMe",
]);
const UPDATE_USER_KEYS = new Set(["name", "timezone"]);
const DELETE_USER_KEYS = new Set(["password", "callbackURL"]);

/** Longest path a mail link or a redirect may carry. It is stored in captured mail, so it is bounded. */
const APP_PATH_MAX = 512;
/** One leading slash, then printable ASCII without a space or a backslash. Never "//host" or "/\host". */
const APP_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;
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
 */
function assertAppPaths(source: unknown): void {
  if (!isRecord(source)) return;
  for (const [field, code] of Object.entries(REDIRECT_FIELDS)) {
    if (!Object.hasOwn(source, field)) continue;
    const value = source[field];
    if (typeof value !== "string" || value.length > APP_PATH_MAX || !APP_PATH.test(value)) {
      throw new APIError("UNPROCESSABLE_ENTITY", {
        code,
        message: `Use a path on this site of at most ${APP_PATH_MAX} characters for ${field}.`,
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
  if (!isValidTimeZone(timezone)) {
    throw new APIError("UNPROCESSABLE_ENTITY", {
      code: "INVALID_TIMEZONE",
      message: "Choose a valid IANA timezone, for example Europe/Berlin.",
    });
  }
}

/**
 * Registration gate. Order matters: a closed or paused deployment says so
 * before anything else is checked, then the access code, then the body.
 */
async function gateSignUp(ctx: GateContext): Promise<void> {
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
  if (body.acceptedTermsVersion !== CONSENT_VERSIONS.terms) {
    throw new APIError("UNPROCESSABLE_ENTITY", {
      code: "TERMS_NOT_ACCEPTED",
      message: "Accept the current terms to create an account.",
    });
  }
  assertTimeZone(body.timezone);
  assertName(body.name);
  if (typeof body.email !== "string" || body.email.length > EMAIL_MAX) {
    throw new APIError("UNPROCESSABLE_ENTITY", { code: "INVALID_EMAIL", message: "Enter a valid email address." });
  }
  if (body.marketingOptIn !== undefined && typeof body.marketingOptIn !== "boolean") {
    throw new APIError("UNPROCESSABLE_ENTITY", {
      code: "INVALID_MARKETING_OPT_IN",
      message: "The marketing choice must be true or false.",
    });
  }
  if (wouldBeAccepted(ctx, body)) await discardPendingAccount(body.email);
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
      await gateSignUp(ctx);
      return;
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
