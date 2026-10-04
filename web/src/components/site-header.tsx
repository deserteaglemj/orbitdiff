import { Logo } from "./logo";
import { Container } from "./page-frame";
import { LinkButton } from "./ui/link-button";

/**
 * Header for public pages: landing, legal, sign in, sign up, and the other signed-out screens.
 * Below 640px only "Sign in" is shown, so the row fits a 360px screen. "Create account" is in the
 * footer of every public page.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <Container className="flex min-h-16 items-center justify-between gap-3">
        <Logo />
        <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
          <LinkButton href="/sign-in" variant="quiet">
            Sign in
          </LinkButton>
          <LinkButton href="/sign-up" variant="primary" className="max-sm:hidden">
            Create account
          </LinkButton>
        </nav>
      </Container>
    </header>
  );
}
