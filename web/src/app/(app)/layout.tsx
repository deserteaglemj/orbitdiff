import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SuspendedScreen } from "@/components/auth/suspended-screen";
import { resolvePageAccess } from "@/server/auth/page-access";
import { requestedPathname } from "@/server/auth/paths";

/**
 * Layout of every signed-in page. Who may see it is decided by the guards
 * (resolvePageAccess), which read the session and the consent log from the
 * database on every request:
 *
 * - no valid session: sign-in;
 * - address not verified: the verify page;
 * - onboarding not complete, or consent missing or outdated: onboarding,
 *   except on the onboarding page itself;
 * - suspended: a plain notice in place of the page.
 *
 * The Admin link is shown only when requireAdmin passes. The link is a
 * convenience: /admin answers 404 to every other account that reaches the page;
 * see docs/web/interface.md section 11.
 *
 * A layout is not rendered again on a client-side navigation, so every page
 * below it calls the guards itself before it loads data.
 *
 * Which page is being asked for comes from the proxy, as a request header. The
 * header is read through requestedPathname(), which ignores it on a request
 * that did not come through the proxy: there the value would be the client's
 * own. An unknown path is treated as a page other than onboarding, so a user
 * who is not onboarded is sent to onboarding.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const access = await resolvePageAccess(requestHeaders, requestedPathname(requestHeaders));
  if (access.kind === "redirect") redirect(access.to);
  if (access.kind === "suspended") return <SuspendedScreen signOutButton={<SignOutButton />} />;
  return (
    <AppShell
      user={{ name: access.user.name, email: access.user.email }}
      isAdmin={access.isAdmin}
      signOutButton={<SignOutButton />}
    >
      {children}
    </AppShell>
  );
}
