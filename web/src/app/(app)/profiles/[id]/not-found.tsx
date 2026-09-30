import type { Metadata } from "next";

import { LinkButton } from "@/components/ui";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Shown for a profile address that is not one of the signed-in user's
 * profiles. The same page answers an id that does not exist, an id that is
 * malformed, and an id of another account, so the three cannot be told apart.
 */
export default function ProfileNotFound() {
  return (
    <div className="py-8 sm:py-12">
      <p className="text-sm font-semibold text-muted">Error 404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Page not found</h1>
      <p className="mt-4 max-w-[60ch] text-muted">
        There is no profile at this address in your account. It may have been removed, or the address may be mistyped.
        Profiles and imports are visible only to the account that owns them, so a link from another account also ends
        here.
      </p>
      <div className="mt-8">
        <LinkButton href="/dashboard" variant="primary">
          Back to the dashboard
        </LinkButton>
      </div>
    </div>
  );
}
