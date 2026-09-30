import { AuthFrame, AuthLinkRow, TextLink } from "./auth-parts";
import { ResetLinkInvalid, ResetPasswordForm } from "./reset-password-form";

export interface ResetPasswordScreenProps {
  /** The token from the reset link, or null when the link carried none. */
  token: string | null;
  /** True when the link came back with an error. */
  linkError: boolean;
}

export function ResetPasswordScreen({ token, linkError }: ResetPasswordScreenProps) {
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
