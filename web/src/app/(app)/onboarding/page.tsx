import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { listTimezones } from "@/components/auth/timezones";
import { initialStep } from "@/components/onboarding/model";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { resolvePageAccess } from "@/server/auth/page-access";
import { DASHBOARD_PATH, ONBOARDING_PATH } from "@/server/auth/paths";
import { getMe } from "@/server/services/account";

export const metadata: Metadata = {
  title: "Set up your account",
};

/**
 * First-run setup. The page asks the guards itself, because the layout above
 * it is not rendered again on a client-side navigation. The account it shows
 * is always the signed-in one: getMe() takes the id from the verified session.
 */
export default async function OnboardingPage() {
  const access = await resolvePageAccess(await headers(), ONBOARDING_PATH);
  if (access.kind === "redirect") redirect(access.to);
  // The layout shows the suspended notice in place of this page.
  if (access.kind === "suspended") return null;

  const me = await getMe(access.user.id);
  const account = {
    name: me.name,
    timezone: me.timezone,
    reviewHour: me.reviewHour,
    onboarded: me.onboarded,
    profiles: me.usage.profiles,
    consent: me.consent,
  };
  if (initialStep(account) === "done") redirect(DASHBOARD_PATH);
  // The versions rendered here are the ones the agreement step names in its request.
  const versions = { terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy };
  return <OnboardingFlow account={account} timezones={listTimezones()} versions={versions} />;
}
