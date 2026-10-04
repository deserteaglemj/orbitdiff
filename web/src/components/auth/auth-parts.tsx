import Link from "next/link";
import type { ReactNode } from "react";

import { Container } from "@/components/page-frame";
import { cx, Notice, PageHeader } from "@/components/ui";

/**
 * Frame of a signed-out account screen: the page title, then the form in a
 * narrow column. On a wide screen an optional second column holds supporting
 * text, so the form stays the first thing in the reading and tab order.
 */
export function AuthFrame({
  title,
  lead,
  children,
  aside,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Container className="py-10 sm:py-14">
      <PageHeader title={title} description={lead} />
      <div
        className={cx(
          "mt-8 grid gap-10",
          aside ? "lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-16" : undefined,
        )}
      >
        <div className="min-w-0 max-w-md">{children}</div>
        {aside ? <aside className="min-w-0 max-w-prose text-sm">{aside}</aside> : null}
      </div>
    </Container>
  );
}

/**
 * Shown wherever an account message is mentioned on a deployment that captures
 * mail. No deployment delivers mail, so the screens never say a message was sent.
 */
export function CapturedMailNotice({ className }: { className?: string }) {
  return (
    <Notice tone="info" title="This deployment stores account messages instead of sending them." className={className}>
      <p>
        Nothing arrives in your inbox. The message is kept in the captured mailbox of this deployment, where the
        operator can read it, including the link it contains.
      </p>
    </Notice>
  );
}

/**
 * Shown in place of a form on a deployment that lacks its configuration (for
 * example no database). No account request can succeed there, so no form is offered.
 */
export function NotConfiguredNotice({ action }: { action: string }) {
  return (
    <Notice tone="warning" title="This deployment is not configured yet.">
      <p>{action} is unavailable until its storage is configured.</p>
    </Notice>
  );
}

/** A line under a form that leads to the neighbouring screen. */
export function AuthLinkRow({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-sm text-muted">{children}</p>;
}

/** Inline text link. The vertical padding brings its tap area to the 24px minimum for inline controls. */
export const TEXT_LINK = "od-link inline-block py-1";

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={TEXT_LINK}>
      {children}
    </Link>
  );
}
