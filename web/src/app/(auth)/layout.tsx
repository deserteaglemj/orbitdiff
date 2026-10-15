import { connection } from "next/server";
import type { ReactNode } from "react";

import { MainContent } from "@/components/page-frame";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * Frame of the signed-out account screens. They are rendered for each request:
 * each one shows the registration and mail state of the deployment as it is
 * now, and the Content-Security-Policy nonce set by the proxy only reaches
 * pages that are rendered per request.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <>
      <SiteHeader />
      <MainContent>{children}</MainContent>
      <SiteFooter />
    </>
  );
}
