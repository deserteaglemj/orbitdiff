import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { nextReviewCaveat } from "@/components/dashboard/card-model";
import { RouteRefreshProvider } from "@/components/settings/refresh-context";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { buildTimezoneList } from "@/components/settings/timezones";
import { CONSENT_VERSIONS, LIMITS } from "@/domain/limits";
import { resolvePageAccess } from "@/server/auth/page-access";
import { readScheduleState } from "@/server/jobs/capacity";
import { getMe } from "@/server/services/account";
import { listProfiles } from "@/server/services/profiles";

export const metadata: Metadata = {
  title: "Settings",
};

const SETTINGS_PATH = "/settings";

/**
 * Settings of the signed-in account. The page asks the guards itself, because
 * the layout above it is not rendered again on a client-side navigation. The
 * account and the profiles it shows are always those of the verified session:
 * both services take the user id the guards returned as their first argument.
 *
 * The timezone list is built here, on the server, so the zones offered are the
 * zones the server accepts. The document versions are the ones this render
 * shows, and a product news grant names the version it was given.
 */
export default async function SettingsPage() {
  const access = await resolvePageAccess(await headers(), SETTINGS_PATH);
  if (access.kind === "redirect") redirect(access.to);
  // The layout shows the suspended notice in place of this page.
  if (access.kind === "suspended") return null;

  const now = new Date();
  const [me, profiles, schedule] = await Promise.all([
    getMe(access.user.id, now),
    listProfiles(access.user.id, { page: 1, pageSize: LIMITS.pageSizeMax }, now),
    readScheduleState(now),
  ]);
  return (
    <RouteRefreshProvider>
      <SettingsScreen
        me={me}
        timezones={buildTimezoneList(me.timezone).zones}
        versions={{ terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy, marketing: CONSENT_VERSIONS.marketing }}
        profiles={profiles.data.map((profile) => ({
          id: profile.id,
          handle: profile.handle,
          status: profile.status,
          nextReviewAt: profile.nextReviewAt,
          // A time that has passed, or that waits for the capacity to reset, is not the next review.
          caveat: nextReviewCaveat(profile, { timeZone: me.timezone, now, schedule }),
        }))}
        schedule={schedule}
      />
    </RouteRefreshProvider>
  );
}
