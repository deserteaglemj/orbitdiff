import "server-only";

import { configurationStatus } from "@/server/configuration";
import { AppError } from "@/server/http/errors";

import { requireAdmin, requireOnboardedUser, requireUser, type SessionUser } from "./guards";
import { ONBOARDING_PATH, SIGN_IN_PATH, signInPath, VERIFY_EMAIL_PATH } from "./paths";

export type PageAccess =
  | { kind: "redirect"; to: string }
  /** The account is suspended. The page says so and shows nothing else. */
  | { kind: "suspended" }
  | { kind: "allowed"; user: SessionUser; isAdmin: boolean; onboarded: boolean };

function isOnboardingPage(pathname: string | null): boolean {
  return pathname === ONBOARDING_PATH || (pathname?.startsWith(`${ONBOARDING_PATH}/`) ?? false);
}

/** True only when requireAdmin passes. Its refusal (`not_found`) is the ordinary answer for everyone else. */
async function passesAdminGuard(headers: Headers): Promise<boolean> {
  try {
    await requireAdmin(headers);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") return false;
    throw error;
  }
}

/**
 * Decide what a signed-in page does with a request, by asking the guards. The
 * guards read the session and the consent log from the database on every call,
 * so nothing here trusts the cookie, the proxy, or an earlier answer.
 *
 * - no valid session: sign-in, remembering the page;
 * - address not verified: the verify page;
 * - suspended: a plain notice, no account data;
 * - onboarding not complete (or consent missing or outdated): onboarding,
 *   except on the onboarding page itself;
 * - otherwise allowed, with `isAdmin` true only when requireAdmin passes.
 *
 * `pathname` is the requested path as the proxy reported it. When it is unknown
 * the page is treated as any page other than onboarding.
 *
 * A deployment that is not configured has no accounts: everyone is sent to
 * sign-in, which explains that state, instead of failing on the first read.
 *
 * Pages under the layout should call this too (or the guards directly) before
 * loading data: a layout is not rendered again on a client-side navigation.
 */
export async function resolvePageAccess(headers: Headers, pathname: string | null): Promise<PageAccess> {
  if (!configurationStatus().configured) return { kind: "redirect", to: SIGN_IN_PATH };
  try {
    const user = await requireOnboardedUser(headers);
    return { kind: "allowed", user, onboarded: true, isAdmin: await passesAdminGuard(headers) };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === "conflict" && error.details?.onboarding === true) {
      if (!isOnboardingPage(pathname)) return { kind: "redirect", to: ONBOARDING_PATH };
      return allowNotOnboarded(headers, pathname);
    }
    return refusal(error, pathname);
  }
}

function refusal(error: AppError, pathname: string | null): PageAccess {
  switch (error.code) {
    case "unauthenticated":
      return { kind: "redirect", to: signInPath(pathname) };
    case "unverified":
      return { kind: "redirect", to: VERIFY_EMAIL_PATH };
    case "suspended":
      return { kind: "suspended" };
    default:
      throw error;
  }
}

/** The onboarding page itself: the user must still be signed in, verified, and active. */
async function allowNotOnboarded(headers: Headers, pathname: string | null): Promise<PageAccess> {
  try {
    const user = await requireUser(headers);
    return { kind: "allowed", user, onboarded: false, isAdmin: await passesAdminGuard(headers) };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return refusal(error, pathname);
  }
}
