import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { authSchemaOptions } from "@/server/auth/options";

export { SIGNUP_CODE_HEADER } from "@/server/auth/signup-code";

/**
 * Better Auth client for the browser. Requests go to /api/auth on the same
 * origin, so no base URL is configured. The additional user fields are inferred
 * from the shared schema options: `timezone`, `acceptedTermsVersion`, and
 * `marketingOptIn` can be sent at sign-up; `status`, `reviewHour`, and
 * `onboardedAt` are readable on the session user and cannot be sent.
 *
 * Sign-up example:
 *   authClient.signUp.email(
 *     { name, email, password, timezone, acceptedTermsVersion, marketingOptIn, callbackURL },
 *     { headers: { [SIGNUP_CODE_HEADER]: code } },
 *   )
 *
 * What the server expects from a screen:
 * - `callbackURL` and `redirectTo` are a path on this site ("/sign-in"), at most
 *   512 characters. A full URL is refused.
 * - The verification link signs no one in and verifies nothing by itself. It
 *   returns to `callbackURL`, which should lead to the sign-in form. The first
 *   sign-in with the right password, in the browser that opened the link and
 *   within an hour, confirms the address. In any other browser sign-in answers
 *   403 EMAIL_NOT_VERIFIED: offer `authClient.sendVerificationEmail`.
 * - A link that is not valid returns to `callbackURL` with `?error=INVALID_TOKEN`.
 * - Registering an address that is still unverified replaces the pending
 *   account and sends a new message.
 * - The reset message links straight to `redirectTo?token=...` (default
 *   "/reset-password"). Pass that token to `authClient.resetPassword`.
 * - A suspended account gets 403 ACCOUNT_SUSPENDED from sign-in and from every
 *   account endpoint except reading the current login and signing out.
 * - 429 with an `X-Retry-After` header means wait: limits apply per client and
 *   per target address.
 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields({ user: authSchemaOptions.user.additionalFields })],
});
