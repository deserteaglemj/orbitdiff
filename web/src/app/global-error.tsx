"use client";

import { buttonClasses } from "@/components/ui/button-classes";

import "./globals.css";

/**
 * Error boundary for a failure in the root layout itself. It replaces the root
 * layout, so it renders its own document and loads the global styles itself.
 * Failures below the root layout are handled by error.tsx.
 *
 * `retry` re-fetches and re-renders what failed (Next.js 16.3). The message of
 * the error is never shown: it can hold internal detail. The digest is a
 * reference that matches the server log and says nothing else.
 *
 * It uses no hook and no component of the app shell, so it keeps working when
 * those are what failed.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong | OrbitDiff Web</title>
      </head>
      <body>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div role="alert">
            <p className="text-sm font-semibold text-danger">Problem</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              OrbitDiff Web could not be shown
            </h1>
            <p className="mt-4 max-w-[60ch] text-muted">
              Something went wrong before the page could load. Your imports and results are not affected. Try again,
              and if it keeps failing, come back later.
            </p>
            {error.digest ? (
              <p className="mt-3 text-sm text-muted">
                Reference: <span className="font-mono text-ink">{error.digest}</span>
              </p>
            ) : null}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" className={buttonClasses({ variant: "primary" })} onClick={() => retry()}>
              Try again
            </button>
            {/* A full page load on purpose: the client router belongs to the layout that failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className={buttonClasses({ variant: "secondary" })}>
              Go to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
