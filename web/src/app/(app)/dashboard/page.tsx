import type { Metadata } from "next";

import { readActivityQuery } from "@/components/dashboard/activity-model";
import { profileCard } from "@/components/dashboard/card-model";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import type { PageQuery } from "@/components/dashboard/query";
import { workspaceUser } from "@/components/dashboard/workspace-access";
import { LIMITS } from "@/domain/limits";
import { readScheduleState } from "@/server/jobs/capacity";
import { listActivity } from "@/server/services/activity";
import { getCountHistory } from "@/server/services/counts";
import { listProfiles } from "@/server/services/profiles";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The dashboard of the signed-in user. Everything is read through the tenant
 * services with the user id the guards returned, so the page can only ever
 * show that user's profiles and activity. The filters of the feed come from
 * the address; a value the page does not know is ignored.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<PageQuery> }) {
  const user = await workspaceUser();
  // The layout shows the suspended notice in place of this page.
  if (user === null) return null;
  const query = await searchParams;
  const now = new Date();

  const [profiles, schedule] = await Promise.all([
    listProfiles(user.id, { pageSize: LIMITS.pageSizeMax }, now),
    readScheduleState(now),
  ]);
  const filters = readActivityQuery(
    query,
    profiles.data.map((profile) => profile.id),
  );
  const [activity, extras] = await Promise.all([
    listActivity(user.id, {
      profileId: filters.profileId,
      kind: filters.kind,
      status: filters.status,
      q: filters.q,
      page: filters.page,
    }),
    Promise.all(
      profiles.data.map(async (profile) => {
        const [counts, processed] = await Promise.all([
          getCountHistory(user.id, profile.id),
          listActivity(user.id, { profileId: profile.id, kind: "import_processed", pageSize: 1 }),
        ]);
        return { counts, lastProcessedAt: processed.data[0]?.occurredAt ?? null };
      }),
    ),
  ]);

  return (
    <DashboardScreen
      timeZone={user.timezone}
      cards={profiles.data.map((profile, index) =>
        // The clock the service judged the evidence with also decides how old each export is.
        profileCard(profile, { ...extras[index], timeZone: user.timezone, now, schedule }),
      )}
      quota={{ used: profiles.pagination.totalItems, limit: LIMITS.profilesPerUser }}
      activity={{ query: filters, page: activity }}
      schedule={schedule}
    />
  );
}
