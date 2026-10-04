import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { listTimezones } from "@/components/auth/timezones";
import { initialStep, onboardingAccount } from "@/components/onboarding/model";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { resolvePageAccess } from "@/server/auth/page-access";
import { DASHBOARD_PATH, ONBOARDING_PATH } from "@/server/auth/paths";
import { getMe } from "@/server/services/account";

export const metadata: Metadata = {
  title: "Set up your account",
};

/**
 * First-run setup, and the place a returning user agrees to a changed
 * document. The page asks the guards itself, because the layout above it is
 * not rendered again on a client-side navigation. The account it shows is
 * always the signed-in one: getMe() takes the id from the verified session.
 *
 * The flow is told two things apart: whether the account is onboarded now
 * (which needs current consent) and whether onboarding was completed before
 * (`onboarded_at`). A returning user starts at the agreement step and is not
 * walked through the first-run steps again.
 */
export default async function OnboardingPage() {
  const access = await resolvePageAccess(await headers(), ONBOARDING_PATH);
  if (access.kind === "redirect") redirect(access.to);
  // The layout shows the suspended notice in place of this page.
  if (access.kind === "suspended") return null;

  const account = onboardingAccount(await getMe(access.user.id), access.user.onboardedAt);
  if (initialStep(account) === "done") redirect(DASHBOARD_PATH);
  // The versions rendered here are the ones the agreement step names in its request.
  const versions = { terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy };
  return <OnboardingFlow account={account} timezones={listTimezones()} versions={versions} />;
}
