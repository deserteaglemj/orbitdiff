import { AuthFrame, AuthLinkRow, NotConfiguredNotice, TextLink } from "./auth-parts";
import { ResetLinkInvalid, ResetPasswordForm } from "./reset-password-form";

export interface ResetPasswordScreenProps {
  /** From readPublicRegistration(). The form is shown only for exactly `true`. */
  configured: boolean;
  /** The token from the reset link, or null when the link carried none. */
  token: string | null;
  /** True when the link came back with an error. */
  linkError: boolean;
}

/**
 * The choose-a-new-password page. A deployment that lacks its configuration
 * has no accounts, so whatever the link carries the page shows the notice in
 * place of a form whose request could not succeed.
 */
export function ResetPasswordScreen({ configured, token, linkError }: ResetPasswordScreenProps) {
  if (configured !== true) {
    return (
      <AuthFrame title="Choose a new password">
        <NotConfiguredNotice action="Choosing a new password" />
      </AuthFrame>
    );
  }
  const usable = token !== null && token.length > 0 && !linkError;
  return (
    <AuthFrame
      title="Choose a new password"
      lead={usable ? "Changing your password signs out every login of this account." : undefined}
    >
      {usable ? <ResetPasswordForm token={token} /> : <ResetLinkInvalid />}
      <AuthLinkRow>
        <TextLink href="/sign-in">Back to sign in</TextLink>
      </AuthLinkRow>
    </AuthFrame>
  );
}
