import "server-only";

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { getDb, type Database } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { getEnv, type Env } from "@/server/env";
import { runInBackground } from "@/server/http/background";
import { sendMail } from "@/server/mail/transport";

import { recordSignupConsent } from "./consent";
import { purgeUserLeftovers } from "./deletion";
import { authGate } from "./gate";
import { authLog } from "./log";
import { authSchemaOptions } from "./options";
import { refuseLoginForSuspended } from "./suspension";

function verificationText(url: string): string {
  return [
    "Confirm your email address for OrbitDiff in two steps.",
    "",
    "1. Open this link:",
    "",
    url,
    "",
    "2. Then sign in, in the same browser, with the password you chose.",
    "",
    "The link works for one hour. Opening the link alone confirms nothing.",
    "If you did not create an OrbitDiff account, ignore this message.",
  ].join("\n");
}

function resetText(url: string): string {
  return [
    "Choose a new OrbitDiff password by opening this link:",
    "",
    url,
    "",
    "The link expires in one hour and signs you out everywhere once used.",
    "If you did not ask for it, ignore this message. Your password stays the same.",
  ].join("\n");
}

const RESET_PAGE = "/reset-password";

/**
 * The link for a reset mail. Better Auth builds a link to its own callback
 * endpoint (/api/auth/reset-password/<token>), which only redirects to the page
 * named in redirectTo. That endpoint is not reachable here: every token value
 * would be a new path for the rate limiter to store. So the mail links to the
 * page itself, carrying the token the same way the redirect would have.
 */
function resetPageUrl(baseUrl: string, callbackLink: string, token: string): string {
  const origin = new URL(baseUrl).origin;
  const requested = new URL(callbackLink).searchParams.get("callbackURL") || RESET_PAGE;
  let page = new URL(requested, origin);
  // The gate only lets a relative path through. Anything else falls back to the default page.
  if (page.origin !== origin) page = new URL(RESET_PAGE, origin);
  page.searchParams.set("token", token);
  return page.href;
}

async function refuseLibraryVerification(): Promise<void> {
  throw new APIError("FORBIDDEN", {
    code: "VERIFICATION_NEEDS_SIGN_IN",
    message: "Open the link, then sign in to confirm your email address.",
  });
}

/**
 * Per client address and endpoint. Stricter than the Better Auth default of 3
 * per 10 seconds. The limits per target address are in address-limit.ts.
 */
const STRICT_RATE_RULES = {
  "/sign-in/email": { window: 60, max: 5 },
  "/sign-up/email": { window: 60, max: 5 },
  "/request-password-reset": { window: 60, max: 3 },
  "/send-verification-email": { window: 60, max: 3 },
} as const;

export interface AuthOverrides {
  /** Force the rate limiter on or off. By default it is on in every stage except test. */
  rateLimit?: boolean;
}

/** Build a Better Auth instance from the current configuration. Use getAuth() unless a test needs overrides. */
export function createAuth(overrides: AuthOverrides = {}) {
  const env = getEnv();
  const secure = env.baseUrl.startsWith("https://");
  return betterAuth({
    ...authSchemaOptions,
    appName: "OrbitDiff",
    baseURL: env.baseUrl,
    trustedOrigins: [env.baseUrl],
    secret: env.authSecret,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    logger: { level: env.stage === "test" ? "error" : "warn", log: authLog },
    // An unexpected error (a failed query, for example) leaves the Better Auth
    // handler instead of being printed by its router, whose raw print includes
    // query parameters. handleAuthRequest logs one redacted line and answers 500.
    onAPIError: { throw: true },
    emailAndPassword: {
      ...authSchemaOptions.emailAndPassword,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      // Better Auth hands the returned promise to backgroundTasks.handler, so the
      // response never waits for the send and its timing does not reveal an account.
      sendResetPassword: ({ user, url, token }) =>
        sendMail({
          to: user.email,
          kind: "reset_password",
          subject: "Reset your OrbitDiff password",
          text: resetText(resetPageUrl(env.baseUrl, url, token)),
        }),
    },
    emailVerification: {
      sendOnSignUp: true,
      // The link never signs anyone in and never verifies by itself: the gate
      // answers /verify-email (see verification.ts). These two settings make
      // Better Auth's own handler refuse as well, should the gate ever be bypassed.
      autoSignInAfterVerification: false,
      beforeEmailVerification: refuseLibraryVerification,
      sendVerificationEmail: ({ user, url }) =>
        sendMail({
          to: user.email,
          kind: "verify_email",
          subject: "Confirm your OrbitDiff email",
          text: verificationText(url),
        }),
    },
    // Sessions are read from the database on every request, so revocation,
    // suspension, and account deletion take effect immediately.
    session: { cookieCache: { enabled: false } },
    // Stored in the rate_limit table, because memory does not survive between
    // serverless invocations. Only HTTP requests are counted: server-side
    // auth.api calls bypass the limiter, which is why the registration gate is a
    // hook on the HTTP endpoint and not a separate server action.
    rateLimit: {
      ...authSchemaOptions.rateLimit,
      enabled: overrides.rateLimit ?? env.stage !== "test",
      customRules: STRICT_RATE_RULES,
    },
    advanced: {
      // The limiter keys on the client address, read from one header that the
      // hosting platform must set and overwrite (see Env.clientIpHeader). A
      // platform that passes a caller's header through makes the per-client
      // limits meaningless; the per-address limits in the gate still hold.
      ipAddress: {
        ipAddressHeaders: [env.clientIpHeader],
        ...(env.trustedProxies.length > 0 ? { trustedProxies: [...env.trustedProxies] } : {}),
      },
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure },
      // Explicit, because Better Auth otherwise skips its origin and callback URL
      // checks whenever NODE_ENV is "test". They stay on in every stage.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      backgroundTasks: { handler: runInBackground },
    },
    // No email change, no OAuth, no account linking, no emailed deletion link.
    disabledPaths: [
      "/change-email",
      "/sign-in/social",
      "/link-social",
      "/unlink-account",
      "/delete-user/callback",
    ],
    user: {
      ...authSchemaOptions.user,
      deleteUser: {
        ...authSchemaOptions.user.deleteUser,
        // The password requirement is enforced by the gate. This removes what the
        // foreign-key cascade cannot reach before the user row goes.
        beforeDelete: (account) => purgeUserLeftovers(account.id, account.email),
      },
    },
    hooks: { before: authGate },
    databaseHooks: {
      session: {
        create: {
          before: async (created) => {
            await refuseLoginForSuspended(created.userId);
          },
        },
      },
      user: {
        create: {
          after: async (created) => {
            await recordSignupConsent(created.id, created.marketingOptIn === true);
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: { env: Env; db: Database; auth: Auth } | undefined;

/**
 * The Better Auth instance, built on first use, so importing this module needs
 * no configuration. It is rebuilt when the configuration or the database pool
 * is replaced, which only happens when tests reset them.
 */
export function getAuth(): Auth {
  const env = getEnv();
  const db = getDb();
  if (cached?.env !== env || cached.db !== db) cached = { env, db, auth: createAuth() };
  return cached.auth;
}
