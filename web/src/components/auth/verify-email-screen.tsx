import { LinkButton, Notice, SectionHeading } from "@/components/ui";

import type { VerifyPageState } from "./auth-errors";
import { AuthFrame, CapturedMailNotice, NotConfiguredNotice } from "./auth-parts";
import { EmailRequestForm } from "./email-request-form";

export interface VerifyEmailScreenProps {
  /** From readPublicRegistration(). The steps and the form are shown only for exactly `true`. */
  configured: boolean;
  /** `waiting` after sign-up, `opened` when the link returned here, `invalid` when it did not work. */
  state: VerifyPageState;
  mailCaptured: boolean;
}

function NewMessage({ mailCaptured }: { mailCaptured: boolean }) {
  return (
    <section className="mt-10 border-t border-line pt-6" aria-labelledby="new-message">
      <SectionHeading
        id="new-message"
        title="Need a new confirmation message?"
        description="Enter the address you signed up with. Registering the address again also replaces an unconfirmed account."
      />
      <div className="mt-5">
        <EmailRequestForm purpose="confirmation" mailCaptured={mailCaptured} />
      </div>
    </section>
  );
}

/**
 * The confirm-your-address page. The link in the confirmation message proves
 * nothing by itself: it leaves a proof in this browser, and the address is
 * confirmed by the first sign-in with the right password from here.
 *
 * A deployment that lacks its configuration has no accounts, so in every state
 * the page shows the notice and nothing else: no claim that an account was
 * created, and no form whose request could not succeed.
 */
export function VerifyEmailScreen({ configured, state, mailCaptured }: VerifyEmailScreenProps) {
  if (configured !== true) {
    return (
      <AuthFrame title="Confirm your email address">
        <NotConfiguredNotice action="Confirming an email address" />
      </AuthFrame>
    );
  }

  if (state === "opened") {
    return (
      <AuthFrame
        title="Confirm your email address"
        lead="The link was opened in this browser. One step is left."
      >
        <Notice tone="info" title="Sign in with your password to confirm your email address.">
          <p>
            The address is confirmed by that sign-in, in this browser, within one hour of opening the link. Opening the
            link alone confirms nothing and signs nobody in.
          </p>
        </Notice>
        <div className="mt-6">
          <LinkButton href="/sign-in?confirm=1" variant="primary" size="lg">
            Sign in
          </LinkButton>
        </div>
      </AuthFrame>
    );
  }

  if (state === "invalid") {
    return (
      <AuthFrame title="Confirm your email address">
        <Notice tone="danger" title="That confirmation link is not valid or has expired.">
          <p>A link works for one hour and only for the account it was created for. Request a new message below.</p>
        </Notice>
        <NewMessage mailCaptured={mailCaptured} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Confirm your email address"
      lead="Your account was created. It can be used once the address is confirmed."
    >
      <ol className="grid list-decimal gap-3 pl-5 text-ink">
        <li>Open the link in the confirmation message, in this browser.</li>
        <li>Sign in here with the password you chose.</li>
      </ol>
      <p className="mt-4 text-sm text-muted">
        The link works for one hour. Opening it alone confirms nothing: the sign-in that follows does.
      </p>
      {/* Directly under the steps, so nobody waits for a message that was never sent. */}
      {mailCaptured ? <CapturedMailNotice className="mt-6" /> : null}
      <NewMessage mailCaptured={mailCaptured} />
    </AuthFrame>
  );
}
