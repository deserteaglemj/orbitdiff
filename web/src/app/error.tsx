"use client";

import { useEffect, useRef } from "react";

import { Logo } from "@/components/logo";
import { Container, MainContent } from "@/components/page-frame";
import { Button, LinkButton } from "@/components/ui";

/**
 * Error boundary for every route under the root layout.
 * `retry` re-fetches and re-renders the segment that failed (Next.js 16.3).
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Move focus to the message so keyboard and screen reader users learn that the page failed.
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    // The message of a server error is already redacted by Next.js in production.
    console.error(error);
  }, [error]);

  return (
    <>
      <header className="border-b border-line">
        <Container className="flex min-h-16 items-center">
          <Logo />
        </Container>
      </header>
      <MainContent>
        <Container className="py-16 sm:py-24">
          <div role="alert">
            <p className="text-sm font-semibold text-danger">Problem</p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              This page could not be shown
            </h1>
            <p className="mt-4 max-w-[60ch] text-muted">
              Something went wrong while loading it. Try again, and if it keeps failing, come back later.
            </p>
            {error.digest ? (
              <p className="mt-3 text-sm text-muted">
                Reference: <span className="font-mono text-ink">{error.digest}</span>
              </p>
            ) : null}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => retry()}>
              Try again
            </Button>
            <LinkButton href="/" variant="secondary">
              Go to the home page
            </LinkButton>
          </div>
        </Container>
      </MainContent>
    </>
  );
}
