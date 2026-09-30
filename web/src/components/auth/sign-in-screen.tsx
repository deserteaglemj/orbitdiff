import { Notice } from "@/components/ui";

import { AuthFrame, AuthLinkRow, NotConfiguredNotice, TextLink } from "./auth-parts";
import { SignInForm } from "./sign-in-form";

export interface SignInScreenProps {
  /** From readPublicRegistration(). The form is shown only for exactly `true`. */
  configured: boolean;
  /** A safe path on this site to continue to after sign-in, or null. */
  next: string | null;
  mailCaptured: boolean;
  /** `confirm`: a confirmation link was just opened here. `reset`: the password was just changed. */
  notice: "confirm" | "reset" | null;
}

export function SignInScreen({ configured, next, mailCaptured, notice }: SignInScreenProps) {
  if (configured !== true) {
    return (
      <AuthFrame title="Sign in to OrbitDiff Web">
        <NotConfiguredNotice action="Signing in" />
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Sign in to OrbitDiff Web" lead="Use the email address and password of your OrbitDiff account.">
      {notice === "confirm" ? (
        <Notice tone="info" title="Sign in with your password to confirm your email address." className="mb-6">
          <p>
            The confirmation link was opened in this browser. Your address is confirmed by this sign-in, within one hour
            of opening the link.
          </p>
        </Notice>
      ) : null}
      {notice === "reset" ? (
        <Notice tone="info" title="Your password was changed." className="mb-6">
          <p>Every earlier login was signed out. Sign in with the new password.</p>
        </Notice>
      ) : null}
      <SignInForm next={next} mailCaptured={mailCaptured} />
      <AuthLinkRow>
        <TextLink href="/forgot-password">Forgot your password?</TextLink>
      </AuthLinkRow>
      <p className="mt-2 text-sm text-muted">
        No account yet? <TextLink href="/sign-up">Create account</TextLink>
      </p>
    </AuthFrame>
  );
}
