import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { SkipLink } from "@/components/page-frame";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "OrbitDiff Web",
    template: "%s | OrbitDiff Web",
  },
  description:
    "Import your own Instagram followers and following export to see mutuals, who does not follow back, and what changed between two exports.",
  applicationName: "OrbitDiff Web",
  icons: {
    icon: [{ url: "/orbitdiff-mark.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The ground colour of the mark. The interface has one theme: light text on this ground.
  themeColor: "#111827",
  colorScheme: "dark",
};

/**
 * Root layout. It renders the skip link as the first focusable element of every page.
 * The target is the `main` element that MainContent renders (see src/components/page-frame.tsx):
 * AppShell includes it for signed-in pages and public pages place it between SiteHeader and SiteFooter.
 *
 * Every page is rendered per request: the Content Security Policy carries a per-request nonce,
 * and a prerendered page would ship scripts without it.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en">
      <body>
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
