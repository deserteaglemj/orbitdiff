import {
  comparisonExtent,
  NOTHING_COMPARED,
  NOTHING_COMPARED_REASON,
  partlyCompared,
} from "@/components/comparison-copy";
import { coverageDetail } from "@/components/dashboard/card-model";
import { formatLocalDateTime, formatLocalTime, zoneLabel } from "@/components/dashboard/local-time";
import { buildHref, firstValue, type QueryValue } from "@/components/dashboard/query";
import { formatCount, UNKNOWN } from "@/components/ui/format";
import { comparability } from "@/domain/export/snapshot";
import type {
  ComparisonRecord,
  CountHistoryDto,
  ExportEventDto,
  ExportEventType,
  Relationship,
  RelationshipDto,
  SnapshotDto,
} from "@/server/services/contracts";

/**
 * The wording of the rows on a profile page. Pure functions over the data
 * transfer types.
 *
 * Rules kept here:
 * - a direction the evidence does not cover is "Unknown", never "No";
 * - a difference between two exports is a difference between two lists,
 *   "observed in your export between" two capture times, and is labelled an
 *   export observation. It is never worded as a follow or an unfollow;
 * - a count is a number or "Unknown". A count row holds no names.
 */
export function triState(value: boolean | null): "Yes" | "No" | "Unknown" {
  if (value === null) return UNKNOWN;
  return value ? "Yes" : "No";
}

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  mutual: "Mutual",
  not_following_back: "Not following back",
  follows_you: "You do not follow back",
  unknown: UNKNOWN,
};

export const RELATIONSHIPS = Object.keys(RELATIONSHIP_LABELS) as Relationship[];

export const RELATIONSHIP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All relationships" },
  ...RELATIONSHIPS.map((value) => ({ value: value as string, label: RELATIONSHIP_LABELS[value] })),
];

export interface RelationshipRow {
  username: string;
  youFollow: string;
  followsYou: string;
  relationship: string;
}

export function relationshipRow(account: RelationshipDto): RelationshipRow {
  return {
    username: account.username,
    youFollow: triState(account.following),
    followsYou: triState(account.followedBy),
    relationship: RELATIONSHIP_LABELS[account.relationship] ?? UNKNOWN,
  };
}

/** Shown with the relationship table. */
export const ABSENCE_NOTE =
  "Absence is interpreted only for a direction you declared complete in a dated export. Without that, an account that is not in a list stays Unknown.";

const EVENT_LABELS: Record<ExportEventType, string> = {
  follower_observed_added: "New in followers list",
  follower_observed_removed: "Gone from followers list",
  following_observed_added: "New in following list",
  following_observed_removed: "Gone from following list",
};

export const EVENT_TYPES = Object.keys(EVENT_LABELS) as ExportEventType[];

export const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All differences" },
  ...EVENT_TYPES.map((value) => ({ value: value as string, label: EVENT_LABELS[value] })),
];

function interval(start: string, end: string, timeZone: string): string {
  return `in your export between ${formatLocalDateTime(start, timeZone)} and ${formatLocalDateTime(
    end,
    timeZone,
  )} (${zoneLabel(timeZone)})`;
}

/** "Observed in your export between <earlier capture time> and <later capture time> (<timezone>)". */
export function observedInterval(start: string, end: string, timeZone: string): string {
  return `Observed ${interval(start, end, timeZone)}`;
}

export const EXPORT_OBSERVATION = "Export observation";

export interface ChangeRow {
  id: string;
  username: string;
  difference: string;
  observed: string;
  evidence: string;
}

export function changeRow(event: ExportEventDto, timeZone: string): ChangeRow {
  return {
    id: event.id,
    username: event.username,
    difference: EVENT_LABELS[event.type] ?? "Difference between two lists",
    observed: observedInterval(event.intervalStart, event.intervalEnd, timeZone),
    evidence: EXPORT_OBSERVATION,
  };
}

export type ChangesKind =
  | "no_import"
  | "undated"
  | "baseline"
  | "pending"
  | "not_comparable"
  | "none_observed"
  | "no_match"
  | "list";

/**
 * Which comparisons the stored imports allow, worked out from their coverage
 * with the rules the derive job uses (see comparability in the export domain).
 */
export function snapshotComparison(snapshots: readonly SnapshotDto[]): ComparisonRecord {
  return comparability(
    snapshots.map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      followers: snapshot.coverage.followers,
      following: snapshot.coverage.following,
    })),
  );
}

export interface ChangesState {
  kind: ChangesKind;
  title: string;
  detail: string;
}

/**
 * What the Changes section shows in place of, or above, its list. The first
 * dated import is a baseline and has no change entries.
 */
export function changesState(input: {
  /** Stored imports of the profile. */
  snapshots: number;
  /** Stored imports that have a capture time. */
  dated: number;
  /** Export observations that match the current filters. */
  events: number;
  /** True when a search text or a type filter is set. */
  filtered: boolean;
  /** Earliest and latest capture time among the dated imports. */
  first: string | null;
  last: string | null;
  timeZone: string;
  /** True while the newest import has not been processed, so the stored observations are of an earlier state. */
  processing?: boolean;
  /** True when processing the newest import failed and nothing processed it since (ProfileDto.processingFailure). */
  processingFailed?: boolean;
  /**
   * Which comparisons the dated imports allowed (see snapshotComparison). Without
   * it, "no differences" is said with the general rule only.
   */
  comparison?: ComparisonRecord | null;
}): ChangesState {
  if (input.snapshots === 0) {
    return {
      kind: "no_import",
      title: "No import yet",
      detail: "Import an export to store a baseline. Differences appear after a second dated import.",
    };
  }
  if (input.dated === 0) {
    return {
      kind: "undated",
      title: "Nothing can be compared yet",
      detail: "No stored import has a capture time, so nothing can be compared. Import an export with its capture time.",
    };
  }
  if (input.dated === 1) {
    return {
      kind: "baseline",
      title: "Nothing to compare yet",
      detail: "Baseline stored. Import a later export to see differences.",
    };
  }
  if (input.events > 0) {
    return {
      kind: "list",
      title: "Export observations",
      detail: "Each row is a difference between two of your dated exports, not a moment at which something happened.",
    };
  }
  if (input.processing && input.processingFailed) {
    return {
      kind: "pending",
      title: "Processing failed",
      detail:
        "Processing the newest import failed. It is tried again once a day. What differs between your dated exports is shown here once it has been processed.",
    };
  }
  if (input.processing) {
    return {
      kind: "pending",
      title: "Processing import",
      detail: "The newest import is still being processed. What differs between your dated exports is shown here when processing finishes.",
    };
  }
  const extent = input.comparison ? comparisonExtent(input.comparison) : null;
  if (extent === "none") {
    // Nothing could be checked, so a filter could not match anything either: say why.
    const span =
      input.first !== null && input.last !== null
        ? `between ${formatLocalDateTime(input.first, input.timeZone)} and ${formatLocalDateTime(
            input.last,
            input.timeZone,
          )} (${zoneLabel(input.timeZone)})`
        : "between your dated imports";
    return {
      kind: "not_comparable",
      title: NOTHING_COMPARED,
      detail: `${NOTHING_COMPARED} ${span}. ${NOTHING_COMPARED_REASON}`,
    };
  }
  if (input.filtered) {
    return {
      kind: "no_match",
      title: "No observations match",
      detail: "No export observation matches this search and filter.",
    };
  }
  const between =
    input.first !== null && input.last !== null
      ? `observed ${interval(input.first, input.last, input.timeZone)}`
      : "observed in your export between your dated imports";
  const scope = extent === "partial" && input.comparison ? partlyCompared(input.comparison) : ".";
  return {
    kind: "none_observed",
    title: "No differences observed",
    detail: `No differences were ${between}${scope} An addition is reported only when the earlier export's direction is complete, and a removal only when the later export's direction is complete.`,
  };
}

export const NOT_RECORDED = "Not recorded";

export interface SnapshotRow {
  id: string;
  captured: string;
  imported: string;
  followersCoverage: string;
  followingCoverage: string;
  followers: string;
  following: string;
  current: boolean;
}

/** A count the coverage supports, or "Unknown" with the number of usernames the file held. */
function countCell(count: number | null, observed: number | null): string {
  if (count !== null) return formatCount(count);
  if (observed === null) return UNKNOWN;
  return `${UNKNOWN} (${formatCount(observed)} ${observed === 1 ? "username" : "usernames"} in the file)`;
}

export function snapshotRow(snapshot: SnapshotDto, timeZone: string): SnapshotRow {
  return {
    id: snapshot.id,
    captured: snapshot.capturedAt === null ? NOT_RECORDED : formatLocalTime(snapshot.capturedAt, timeZone),
    imported: formatLocalTime(snapshot.importedAt, timeZone),
    followersCoverage: coverageDetail(snapshot.coverage.followers),
    followingCoverage: coverageDetail(snapshot.coverage.following),
    followers: countCell(snapshot.followers, snapshot.followersObserved),
    following: countCell(snapshot.following, snapshot.followingObserved),
    current: snapshot.isCurrent,
  };
}

export interface CountRow {
  id: string;
  captured: string;
  followers: string;
  following: string;
}

/** The count series, newest first. Numbers only: a count never names accounts. */
export function countRows(history: CountHistoryDto, timeZone: string): CountRow[] {
  return [...history.points].reverse().map((point) => ({
    id: point.snapshotId,
    captured: formatLocalTime(point.capturedAt, timeZone),
    followers: formatCount(point.followers),
    following: formatCount(point.following),
  }));
}

export type ProfileTab = "relationships" | "changes" | "imports" | "counts" | "activity";

export const PROFILE_TABS: ReadonlyArray<{ id: ProfileTab; label: string }> = [
  { id: "relationships", label: "Relationships" },
  { id: "changes", label: "Changes" },
  { id: "imports", label: "Import history" },
  { id: "counts", label: "Counts" },
  { id: "activity", label: "Activity" },
];

const DEFAULT_TAB: ProfileTab = "relationships";

export function readTab(value: QueryValue): ProfileTab {
  const text = firstValue(value);
  return PROFILE_TABS.find((tab) => tab.id === text)?.id ?? DEFAULT_TAB;
}

export function profileHref(profileId: string): string {
  return `/profiles/${profileId}`;
}

export function tabHref(profileId: string, tab: ProfileTab): string {
  return buildHref(profileHref(profileId), { tab: tab === DEFAULT_TAB ? null : tab });
}

/** What the confirmation says before a profile is removed: everything that goes with it. */
export function removalDescription(handle: string, snapshotCount: number): string {
  const opening = `This permanently deletes the profile ${handle} from your account`;
  if (snapshotCount === 0) {
    return `${opening}, with its scheduled reviews and its activity entries. It has no stored imports. This cannot be undone.`;
  }
  const imports = `${snapshotCount} stored ${snapshotCount === 1 ? "import" : "imports"}`;
  return `${opening}: its ${imports} with the follower and following usernames in them, the export observations and the count history derived from them, its queued and scheduled reviews, and its activity entries. Your other profiles are not affected. This cannot be undone.`;
}
