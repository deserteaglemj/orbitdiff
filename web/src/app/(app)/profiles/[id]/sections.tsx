import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { readActivityQuery } from "@/components/dashboard/activity-model";
import { type PageQuery, readChoice, readPage, readSearch } from "@/components/dashboard/query";
import { importHrefOf, SECTION_ANCHOR } from "@/components/profile/profile-screen";
import { changesState, EVENT_TYPES, profileHref, RELATIONSHIPS } from "@/components/profile/rows";
import { ChangesSection, CountsSection, ImportsSection, RelationshipsSection } from "@/components/profile/sections";
import { LIMITS } from "@/domain/limits";
import { listActivity } from "@/server/services/activity";
import type { ProfileDto } from "@/server/services/contracts";
import { getCountHistory } from "@/server/services/counts";
import { listEvents } from "@/server/services/events";
import { listSnapshots } from "@/server/services/imports";
import { listRelationships } from "@/server/services/relationships";

/**
 * The data of one section of a profile page. Each loader reads through the
 * tenant services with the user id the guards returned and the profile the
 * page already found to be that user's. The services check the ownership
 * again in their own queries.
 */
export interface SectionProps {
  userId: string;
  profile: ProfileDto;
  query: PageQuery;
  timeZone: string;
}

export async function RelationshipsLoader({ userId, profile, query }: SectionProps) {
  const filters = {
    q: readSearch(query.q),
    relationship: readChoice(query.relationship, RELATIONSHIPS),
    page: readPage(query.page),
  };
  const page = await listRelationships(userId, profile.id, filters);
  return (
    <RelationshipsSection
      profileId={profile.id}
      hasImport={profile.currentSnapshotId !== null}
      importHref={importHrefOf(profile.id)}
      filters={filters}
      page={page}
    />
  );
}

export async function ChangesLoader({ userId, profile, query, timeZone }: SectionProps) {
  const filters = { q: readSearch(query.q), type: readChoice(query.type, EVENT_TYPES), page: readPage(query.page) };
  const [events, snapshots] = await Promise.all([
    listEvents(userId, { profileId: profile.id, type: filters.type, q: filters.q, page: filters.page }),
    listSnapshots(userId, profile.id, { pageSize: LIMITS.snapshotsPerProfile }),
  ]);
  // Newest capture first, undated imports last.
  const dated = snapshots.data.filter((snapshot) => snapshot.capturedAt !== null);
  const state = changesState({
    snapshots: snapshots.pagination.totalItems,
    dated: dated.length,
    events: events.pagination.totalItems,
    filtered: filters.q !== "" || filters.type !== null,
    first: dated[dated.length - 1]?.capturedAt ?? null,
    last: dated[0]?.capturedAt ?? null,
    timeZone,
    processing: profile.processing,
  });
  return (
    <ChangesSection
      profileId={profile.id}
      importHref={importHrefOf(profile.id)}
      state={state}
      processing={profile.processing}
      filters={filters}
      page={events}
      timeZone={timeZone}
    />
  );
}

export async function ImportsLoader({ userId, profile, query, timeZone }: SectionProps) {
  const pageNumber = readPage(query.page);
  const page = await listSnapshots(userId, profile.id, { page: pageNumber });
  return (
    <ImportsSection
      profileId={profile.id}
      importHref={importHrefOf(profile.id)}
      page={page}
      pageNumber={pageNumber}
      timeZone={timeZone}
    />
  );
}

export async function CountsLoader({ userId, profile, timeZone }: SectionProps) {
  const history = await getCountHistory(userId, profile.id);
  return <CountsSection importHref={importHrefOf(profile.id)} history={history} timeZone={timeZone} />;
}

export async function ActivityLoader({ userId, profile, query, timeZone }: SectionProps) {
  const filters = { ...readActivityQuery(query, []), q: "" };
  const page = await listActivity(userId, {
    profileId: profile.id,
    kind: filters.kind,
    status: filters.status,
    page: filters.page,
  });
  return (
    <ActivityFeed
      path={profileHref(profile.id)}
      fixed={{ tab: "activity" }}
      anchor={SECTION_ANCHOR}
      query={filters}
      page={page}
      timeZone={timeZone}
    />
  );
}
