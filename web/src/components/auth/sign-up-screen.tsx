import type { PublicRegistration } from "@/server/auth/public-state";

import { LinkButton, Notice } from "@/components/ui";

import { AuthFrame, AuthLinkRow, CapturedMailNotice, TextLink } from "./auth-parts";
import { SignUpForm } from "./sign-up-form";

export interface SignUpScreenProps {
  /** From readPublicRegistration(), which reports what the sign-up gate itself will do. */
  registration: PublicRegistration;
  /** The versions of the two documents as the server holds them when the page is rendered. */
  termsVersion: string;
  privacyVersion: string;
  timezones: string[];
}

const LEAD =
  "An OrbitDiff account is separate from your Instagram account. OrbitDiff Web never asks for your Instagram password, codes, or session.";

/**
 * The sign-up page. The form is shown only when registration is open, which
 * means exactly `open === true`. In every other case the reason takes its place.
 */
export function SignUpScreen({ registration, termsVersion, privacyVersion, timezones }: SignUpScreenProps) {
  if (registration.open !== true) {
    return (
      <AuthFrame title="Create your OrbitDiff account" lead={LEAD}>
        <Notice
          tone="warning"
          title={registration.reason ?? "Registration is closed."}
          actions={
            <LinkButton href="/sign-in" variant="secondary">
              Sign in
            </LinkButton>
          }
        >
          <p>New accounts cannot be created on this deployment right now. An existing account can still sign in.</p>
        </Notice>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Create your OrbitDiff account"
      lead={LEAD}
      aside={registration.mailCaptured ? <CapturedMailNotice /> : undefined}
    >
      {/* Before the fields, in the reading order and on a phone too: read first, then type. */}
      <section aria-labelledby="collected" className="mb-8 text-sm">
        <h2 id="collected" className="font-semibold text-ink">
          What this form collects and why
        </h2>
        <p className="mt-1 text-muted">
          Your email address and password sign you in. Your display name is shown in the app. Your timezone sets the
          local hour of the daily review. Your agreement and your product news choice are recorded with their version
          and time. The <TextLink href="/legal/privacy">Privacy notice</TextLink> has the full list.
        </p>
      </section>
      <SignUpForm
        termsVersion={termsVersion}
        privacyVersion={privacyVersion}
        timezones={timezones}
        accessCodeRequired={registration.accessCodeRequired === true}
      />
      <AuthLinkRow>
        Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
      </AuthLinkRow>
    </AuthFrame>
  );
}
