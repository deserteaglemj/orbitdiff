"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cx } from "./ui/classes";

/**
 * A navigation link that marks itself as the current page for its own path and every path under it.
 * The current page is shown with an underline bar and a heavier weight, not by colour alone.
 */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "inline-flex min-h-10 items-center rounded-lg border-b-2 px-3 text-sm transition-colors hover:bg-raised",
        current ? "border-blue font-semibold text-ink" : "border-transparent font-medium text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
