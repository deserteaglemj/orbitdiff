import type { Metadata } from "next";

import { verifyPageState } from "@/components/auth/auth-errors";
import { VerifyEmailScreen } from "@/components/auth/verify-email-screen";
import { readPublicRegistration } from "@/server/auth/public-state";

import type { PageQuery } from "../query";

export const metadata: Metadata = {
  title: "Confirm your email address",
};

/**
 * Three states, chosen from the query: waiting (after sign-up), opened (the
 * confirmation link returned here with `step=opened`), and invalid (it returned
 * with `error=<code>`). Opening the link verifies nothing by itself: the server
 * leaves a proof in this browser and the next sign-in completes it.
 *
 * On a deployment that is not configured the screen shows a notice in place of
 * all three, as the sign-in, sign-up, and forgot-password pages do.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: PageQuery }) {
  const query = await searchParams;
  const registration = await readPublicRegistration();
  return (
    <VerifyEmailScreen
      configured={registration.configured}
      state={verifyPageState(query)}
      mailCaptured={registration.mailCaptured}
    />
  );
}
