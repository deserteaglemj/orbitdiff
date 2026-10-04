import { AuthFrame, AuthLinkRow, CapturedMailNotice, NotConfiguredNotice, TextLink } from "./auth-parts";
import { EmailRequestForm } from "./email-request-form";

export interface ForgotPasswordScreenProps {
  /** From readPublicRegistration(). The form is shown only for exactly `true`. */
  configured: boolean;
  mailCaptured: boolean;
}

export function ForgotPasswordScreen({ configured, mailCaptured }: ForgotPasswordScreenProps) {
  if (configured !== true) {
    return (
      <AuthFrame title="Reset your password">
        <NotConfiguredNotice action="Resetting a password" />
      </AuthFrame>
    );
  }
  return (
    <AuthFrame
      title="Reset your password"
      lead="Enter the email address of your OrbitDiff account. The reset message holds a link that works for one hour."
      aside={mailCaptured ? <CapturedMailNotice /> : undefined}
    >
      <EmailRequestForm purpose="reset" mailCaptured={mailCaptured} />
      <AuthLinkRow>
        Remembered it? <TextLink href="/sign-in">Sign in</TextLink>
      </AuthLinkRow>
    </AuthFrame>
  );
}
