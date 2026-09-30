import type { Metadata } from "next";

import { ForgotPasswordScreen } from "@/components/auth/forgot-password-screen";
import { readPublicRegistration } from "@/server/auth/public-state";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default async function ForgotPasswordPage() {
  const registration = await readPublicRegistration();
  return <ForgotPasswordScreen configured={registration.configured} mailCaptured={registration.mailCaptured} />;
}
