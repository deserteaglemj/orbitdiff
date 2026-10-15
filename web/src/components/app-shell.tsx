import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "./logo";
import { NavLink } from "./nav-link";
import { Container, MainContent } from "./page-frame";

export interface AppShellProps {
  /** The signed-in user, shown so it is clear which OrbitDiff account is in use. */
  user: { name: string; email: string };
  /** Shows the Admin link. The server decides this; the link is only a convenience. */
  isAdmin: boolean;
  /** The sign-out control. The shell only places it. */
  signOutButton: ReactNode;
  children: ReactNode;
}

const FOOTER_LINK = "inline-flex min-h-10 items-center rounded-lg underline-offset-4 hover:text-ink hover:underline";

/**
 * Frame for signed-in pages: brand, navigation, the signed-in account, sign out, the main landmark,
 * and a short footer. On a phone the navigation sits on its own row under the brand.
 */
export function AppShell({ user, isAdmin, signOutButton, children }: AppShellProps) {
  const displayName = user.name.trim() || user.email;
  return (
    <>
      <header className="border-b border-line">
        <Container className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3 md:flex-nowrap">
          <Logo href="/dashboard" className="order-1" />
          <nav aria-label="Main" className="order-3 -mx-3 flex w-full items-center gap-1 md:order-2 md:mx-0 md:w-auto">
            <NavLink href="/dashboard">Dashboard</NavLink>
            <NavLink href="/settings">Settings</NavLink>
            {isAdmin ? <NavLink href="/admin">Admin</NavLink> : null}
          </nav>
          <div className="order-2 ml-auto flex min-w-0 items-center gap-3 md:order-3">
            <p className="hidden min-w-0 text-right text-sm leading-tight md:block">
              <span className="sr-only">Signed in as </span>
              <span className="block max-w-56 truncate font-medium text-ink">{displayName}</span>
              {displayName !== user.email ? (
                <span className="block max-w-56 truncate text-muted">{user.email}</span>
              ) : null}
            </p>
            {signOutButton}
          </div>
        </Container>
      </header>
      <MainContent>
        <Container className="py-8 sm:py-10">{children}</Container>
      </MainContent>
      <footer className="mt-10 border-t border-line">
        <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-4 text-sm text-muted">
          <p className="min-w-0 truncate md:hidden">Signed in as {user.email}</p>
          <p className="hidden md:block">OrbitDiff Web works from the exports you import.</p>
          <ul className="flex flex-wrap gap-x-5">
            <li>
              <Link href="/legal/privacy" className={FOOTER_LINK}>
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/legal/terms" className={FOOTER_LINK}>
                Terms
              </Link>
            </li>
          </ul>
        </Container>
      </footer>
    </>
  );
}
