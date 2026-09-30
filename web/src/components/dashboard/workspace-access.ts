import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { SessionUser } from "@/server/auth/guards";
import { resolvePageAccess } from "@/server/auth/page-access";
import { ONBOARDING_PATH, requestedPathname } from "@/server/auth/paths";

/**
 * The signed-in, verified, onboarded user of this request, decided by the
 * guards. Every page of the workspace calls this before it loads data, because
 * the layout above it is not rendered again on a client-side navigation.
 *
 * Redirects to sign-in, to the verify page, or to onboarding exactly as the
 * layout does. Returns null for a suspended account: the layout shows the
 * notice and the page renders nothing.
 *
 * The id of the returned user is the only user id a workspace page passes to
 * a service.
 *
 * The page to come back to after sign-in is the path the proxy reported, read
 * through requestedPathname() as the layout reads it. On a request that did
 * not come through the proxy that header is the client's own value and is
 * ignored.
 */
export async function workspaceUser(): Promise<SessionUser | null> {
  const requestHeaders = await headers();
  const access = await resolvePageAccess(requestHeaders, requestedPathname(requestHeaders));
  if (access.kind === "redirect") redirect(access.to);
  if (access.kind === "suspended") return null;
  if (!access.onboarded) redirect(ONBOARDING_PATH);
  return access.user;
}
