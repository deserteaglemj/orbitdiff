import type { Metadata } from "next";

import { Container, MainContent } from "@/components/page-frame";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { LinkButton } from "@/components/ui";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <MainContent>
        <Container className="py-16 sm:py-24">
          <p className="text-sm font-semibold text-muted">Error 404</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Page not found</h1>
          <p className="mt-4 max-w-[60ch] text-muted">
            There is no page at this address. It may have been removed, or the address may be mistyped. Profiles and
            imports are visible only to the account that owns them, so a link from another account also ends here.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/" variant="primary">
              Go to the home page
            </LinkButton>
            <LinkButton href="/sign-in" variant="secondary">
              Sign in
            </LinkButton>
          </div>
        </Container>
      </MainContent>
      <SiteFooter />
    </>
  );
}
