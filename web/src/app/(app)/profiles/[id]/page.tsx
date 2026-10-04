import type { Metadata } from "next";
import { Suspense } from "react";

import type { PageQuery } from "@/components/dashboard/query";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { type ProfileTab, readTab } from "@/components/profile/rows";
import { Skeleton } from "@/components/ui";
import { readScheduleState } from "@/server/jobs/capacity";
import { listActivity } from "@/server/services/activity";

import { loadOwnedProfile } from "./load";
import {
  ActivityLoader,
  ChangesLoader,
  CountsLoader,
  ImportsLoader,
  RelationshipsLoader,
  type SectionProps,
} from "./sections";

type Params = Promise<{ id: string }>;

/** The handle of the user's own profile. Any other id gets the title of the not-found page. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const owned = await loadOwnedProfile((await params).id);
  return { title: owned ? owned.profile.handle : "Profile" };
}

const LOADERS: Record<ProfileTab, (props: SectionProps) => Promise<React.JSX.Element>> = {
  relationships: RelationshipsLoader,
  changes: ChangesLoader,
  imports: ImportsLoader,
  counts: CountsLoader,
  activity: ActivityLoader,
};

/**
 * The profile of the signed-in user with this id, or the not-found page (see
 * loadOwnedProfile). The ownership check runs before anything is streamed, so
 * a missing or foreign id is a real 404. The sections below it stream in
 * behind a loading state.
 */
export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<PageQuery>;
}) {
  const owned = await loadOwnedProfile((await params).id);
  // The layout shows the suspended notice in place of this page.
  if (owned === null) return null;
  const { user, profile, now } = owned;
  const query = await searchParams;
  const tab = readTab(query.tab);
  const [processed, schedule] = await Promise.all([
    listActivity(user.id, { profileId: profile.id, kind: "import_processed", pageSize: 1 }),
    readScheduleState(now),
  ]);
  const Section = LOADERS[tab];

  return (
    <ProfileScreen
      profile={profile}
      timeZone={user.timezone}
      lastProcessedAt={processed.data[0]?.occurredAt ?? null}
      tab={tab}
      now={now}
      schedule={schedule}
    >
      <Suspense key={JSON.stringify([tab, query])} fallback={<Skeleton label="Loading this section" lines={6} />}>
        <Section userId={user.id} profile={profile} query={query} timeZone={user.timezone} />
      </Suspense>
    </ProfileScreen>
  );
}
