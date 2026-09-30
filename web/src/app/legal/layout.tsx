import { connection } from "next/server";
import type { ReactNode } from "react";

import { MainContent } from "@/components/page-frame";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * The legal pages are rendered for each request, for two reasons: they show the
 * operator name that is configured right now, and the Content-Security-Policy
 * nonce set by the proxy only reaches pages that are rendered per request.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <>
      <SiteHeader />
      <MainContent>{children}</MainContent>
      <SiteFooter />
    </>
  );
}
