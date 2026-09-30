import type { ReactNode } from "react";

import { MainContent } from "@/components/page-frame";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <MainContent>{children}</MainContent>
      <SiteFooter />
    </>
  );
}
