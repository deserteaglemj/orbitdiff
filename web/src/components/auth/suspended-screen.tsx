import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { Container, MainContent } from "@/components/page-frame";
import { PageHeader } from "@/components/ui";

/**
 * What a suspended account sees in place of every signed-in page: the fact, and
 * a way to sign out. It shows no account data, and no navigation into the app.
 */
export function SuspendedScreen({ signOutButton }: { signOutButton: ReactNode }) {
  return (
    <>
      <header className="border-b border-line">
        <Container className="flex min-h-16 items-center justify-between gap-3">
          <Logo />
          {signOutButton}
        </Container>
      </header>
      <MainContent>
        <Container className="py-16 sm:py-24">
          <PageHeader
            title="This account is suspended"
            description="A suspended account cannot open its profiles, imports, or settings, and it cannot be deleted while it is suspended. You can sign out."
          />
        </Container>
      </MainContent>
    </>
  );
}
