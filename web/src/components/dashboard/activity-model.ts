import type { ActivityDto, ActivityKind, ActivityStatus } from "@/server/services/contracts";

import type { StatusBadge } from "./card-model";
import { formatLocalTime } from "./local-time";
import { buildHref, type PageQuery, readChoice, readPage, readSearch, firstValue } from "./query";

/**
 * The activity feed as a screen shows it. The title and the detail of an
 * entry are worded by the service (src/server/services/activity.ts) and are
 * shown as they are. This module adds the local time, the labels, and the
 * filters.
 */
const KIND_LABELS: Record<ActivityKind, string> = {
  import_received: "Import received",
  import_processed: "Import processed",
  review: "Review",
  job_failed: "Failure",
  profile_added: "Profile added",
  profile_paused: "Profile paused",
  profile_resumed: "Profile resumed",
};

const STATUS_BADGES: Record<ActivityStatus, StatusBadge> = {
  ok: { tone: "ok", text: "Done" },
  failed: { tone: "danger", text: "Failed" },
  info: { tone: "neutral", text: "Recorded" },
};

const KINDS = Object.keys(KIND_LABELS) as ActivityKind[];
const STATUSES = Object.keys(STATUS_BADGES) as ActivityStatus[];

export const ACTIVITY_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All kinds" },
  ...KINDS.map((kind) => ({ value: kind as string, label: KIND_LABELS[kind] })),
];

export const ACTIVITY_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  ...STATUSES.map((status) => ({ value: status as string, label: STATUS_BADGES[status].text })),
];

export interface ActivityRow {
  id: string;
  title: string;
  detail: string;
  /** Local time with the timezone named. */
  when: string;
  kind: string;
  badge: StatusBadge;
  handle: string | null;
  profileHref: string | null;
}

export function activityRow(entry: ActivityDto, timeZone: string): ActivityRow {
  return {
    id: entry.id,
    title: entry.title,
    detail: entry.detail ?? "",
    when: formatLocalTime(entry.occurredAt, timeZone),
    kind: KIND_LABELS[entry.kind] ?? entry.kind,
    badge: STATUS_BADGES[entry.status] ?? STATUS_BADGES.info,
    handle: entry.profileHandle,
    profileHref: entry.profileId === null ? null : `/profiles/${entry.profileId}`,
  };
}

export interface ActivityQuery {
  profileId: string | null;
  kind: ActivityKind | null;
  status: ActivityStatus | null;
  /** Profile handle text to search for. Empty when there is none. */
  q: string;
  page: number;
}

/**
 * The feed filters from the address. The profile filter is accepted only for
 * one of the user's own profile ids: any other value, including an id of
 * another account, is dropped, so it can neither fail the page nor show
 * anything that is not the user's.
 */
export function readActivityQuery(query: PageQuery, ownProfileIds: readonly string[]): ActivityQuery {
  const profile = firstValue(query.profile);
  return {
    profileId: ownProfileIds.includes(profile) ? profile : null,
    kind: readChoice(query.kind, KINDS),
    status: readChoice(query.status, STATUSES),
    q: readSearch(query.q),
    page: readPage(query.page),
  };
}

/** The id of the feed section, the target of its links. */
export const ACTIVITY_ANCHOR = "activity";

/**
 * A link to a page of the feed that keeps the filters. `fixed` holds
 * parameters of the host page, and `anchor` is the id the link scrolls to.
 */
export function activityHref(
  path: string,
  query: ActivityQuery,
  page: number,
  fixed: Record<string, string> = {},
  anchor: string = ACTIVITY_ANCHOR,
): string {
  return buildHref(
    path,
    { ...fixed, q: query.q, profile: query.profileId, kind: query.kind, status: query.status, page },
    anchor,
  );
}
