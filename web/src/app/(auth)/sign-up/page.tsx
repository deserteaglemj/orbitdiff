import type { Metadata } from "next";

import { SignUpScreen } from "@/components/auth/sign-up-screen";
import { listTimezones } from "@/components/auth/timezones";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { readPublicRegistration } from "@/server/auth/public-state";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create an OrbitDiff account. It is separate from your Instagram account.",
};

/**
 * The registration state comes from readPublicRegistration(), which reports
 * what GET /api/health reports: the answer of the sign-up gate itself. When
 * registration is not open, the reason is shown in place of the form.
 */
export default async function SignUpPage() {
  const registration = await readPublicRegistration();
  // The versions rendered here are the ones the form names when the agreement box is ticked.
  return (
    <SignUpScreen
      registration={registration}
      termsVersion={CONSENT_VERSIONS.terms}
      privacyVersion={CONSENT_VERSIONS.privacy}
      timezones={listTimezones()}
    />
  );
}
