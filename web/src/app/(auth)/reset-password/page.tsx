import type { Metadata } from "next";

import { ResetPasswordScreen } from "@/components/auth/reset-password-screen";
import { readPublicRegistration } from "@/server/auth/public-state";

import { single, type PageQuery } from "../query";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The address of this page carries a one-time token. Keep it out of search results and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Longest token the page hands to the form. A real one is far shorter. */
const TOKEN_MAX_CHARS = 1_024;

/**
 * The reset message links here with `token=...`. A link that did not work
 * returns with `error=...`. On a deployment that is not configured the screen
 * shows a notice in place of the form, whatever the link carries.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: PageQuery }) {
  const query = await searchParams;
  const registration = await readPublicRegistration();
  return (
    <ResetPasswordScreen
      configured={registration.configured}
      token={single(query.token, TOKEN_MAX_CHARS)}
      linkError={query.error !== undefined}
    />
  );
}
