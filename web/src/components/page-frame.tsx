import type { ReactNode } from "react";

import { cx } from "./ui/classes";

/** The id the skip link points at. `MainContent` renders it. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * The first focusable element of every page. It is rendered once, by the root layout.
 * It is hidden until it receives keyboard focus.
 */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only rounded-lg bg-ink font-semibold text-ground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2"
    >
      Skip to main content
    </a>
  );
}

/**
 * The page's single `main` landmark and the skip link target. Every page renders exactly one:
 * AppShell does it for signed-in pages, public pages place it between SiteHeader and SiteFooter.
 */
export function MainContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className={cx("flex-1", className)}>
      {children}
    </main>
  );
}

/** The page width: 1152px at most, with 16px gutters on a phone. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}
