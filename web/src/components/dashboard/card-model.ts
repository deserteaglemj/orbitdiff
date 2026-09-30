import type { BadgeTone } from "@/components/ui/badge";
import { formatDate } from "@/components/ui/format";
import type { SparkPoint } from "@/components/ui/sparkline-geometry";
import { captureTimeMillis } from "@/domain/capture-time";
import { LIMITS } from "@/domain/limits";
import type { CountHistoryDto, CoverageDto, EvidenceStatus, ProfileDto } from "@/server/services/contracts";

import { formatLocalTime } from "./local-time";

/**
 * What a profile card and the profile header show, worked out from the data
 * transfer types. Pure functions: no request, no markup, and no clock of their
 * own (the page hands in the time of the request).
 *
 * Rules kept here:
 * - a count the coverage does not support stays `null` and is shown as "Unknown";
 * - coverage is "declared by you", never verified;
 * - how old the export is gets decided apart from its coverage, so an export
 *   with incomplete coverage is still marked stale once it is old or undated;
 * - a failure is its own statement next to the last success and replaces nothing;
 * - a count change is the wording the service returns, and carries no names.
 */
export interface StatusBadge {
  tone: BadgeTone;
  text: string;
}

export const STALE_HOURS = LIMITS.staleAfterMs / 3_600_000;

const EVIDENCE: Record<EvidenceStatus, StatusBadge & { note: string }> = {
  missing: { tone: "neutral", text: "No evidence yet", note: "Import an export to store a baseline." },
  degraded: {
    tone: "warning",
    text: "Incomplete coverage",
    note: "At least one direction is not complete, so some relationships and counts stay unknown.",
  },
  stale: {
    tone: "warning",
    text: "Stale",
    note: `The current export was captured more than ${STALE_HOURS} hours ago. Import a newer export to refresh it.`,
  },
  ok: {
    tone: "ok",
    text: "Current",
    note: `Both directions are complete and the export was captured within the last ${STALE_HOURS} hours.`,
  },
};

export function evidenceBadge(evidence: EvidenceStatus): StatusBadge {
  const { tone, text } = EVIDENCE[evidence];
  return { tone, text };
}

export function evidenceNote(evidence: EvidenceStatus): string {
  return EVIDENCE[evidence].note;
}

/**
 * How old the current export is at `now`: `stale` once its capture time is
 * more than LIMITS.staleAfterMs back, `undated` when it has no capture time,
 * `none` before the first import.
 *
 * This is the `stale` flag of the domain view (buildView in
 * src/domain/export/snapshot.ts), which the profile data does not carry. The
 * evidence status cannot stand in for it: it is "degraded" for every export
 * with a direction that is not complete, however old that export is.
 */
export type ExportAge = "none" | "fresh" | "stale" | "undated";

type Dated = Pick<ProfileDto, "currentSnapshotId" | "capturedAt">;
type Aged = Dated & Pick<ProfileDto, "evidence">;

export function exportAge(profile: Dated, now: Date): ExportAge {
  if (profile.currentSnapshotId === null) return "none";
  if (profile.capturedAt === null) return "undated";
  return now.getTime() - captureTimeMillis(profile.capturedAt) > LIMITS.staleAfterMs ? "stale" : "fresh";
}

const UNDATED_NOTE =
  "The current export has no capture time, so its age is unknown. Import it again with its capture time, or import a newer export.";

/**
 * What to say about the age of a stale export, or null when the export is not
 * stale. An undated export is stale too, and is never given an age.
 */
export function staleNote(profile: Aged, now: Date): string | null {
  const age = exportAge(profile, now);
  if (age === "undated") return UNDATED_NOTE;
  // The service decided "stale" with its own clock. That answer stands.
  return age === "stale" || profile.evidence === "stale" ? EVIDENCE.stale.note : null;
}

/** The evidence badge, and "Stale" next to it when the evidence status does not say so itself. */
export function statusBadges(profile: Aged, now: Date): StatusBadge[] {
  const badges = [evidenceBadge(profile.evidence)];
  if (profile.evidence !== "stale" && staleNote(profile, now) !== null) badges.push(evidenceBadge("stale"));
  return badges;
}

/** The evidence note, and the age of a stale export when the evidence note does not state it. */
export function statusNotes(profile: Aged, now: Date): string[] {
  const notes = [evidenceNote(profile.evidence)];
  const stale = staleNote(profile, now);
  if (profile.evidence !== "stale" && stale !== null) notes.push(stale);
  return notes;
}

/** Where the numbers come from: the owner's own export and the capture time the owner declared. */
export function sourceLine(profile: Pick<ProfileDto, "currentSnapshotId" | "capturedAt">, timeZone: string): string {
  if (profile.currentSnapshotId === null) return "No import yet";
  if (profile.capturedAt === null) return "Owner export, capture time not recorded";
  return `Owner export, captured ${formatLocalTime(profile.capturedAt, timeZone)}`;
}

/** Coverage of one direction in words, with the reason when it is only partial. */
export function coverageDetail(coverage: CoverageDto): string {
  if (!coverage.present) return "Not supplied";
  if (coverage.complete) return "Complete, declared by you";
  const reasons: string[] = [];
  if (!coverage.declaredComplete) reasons.push("not declared complete");
  if (!coverage.shardsContiguous) reasons.push("numbered files are missing");
  if (!coverage.capturedAtKnown) reasons.push("no capture time");
  return reasons.length > 0 ? `Partial: ${reasons.join(", ")}` : "Partial";
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** Both directions in one line, or null before the first processed import. */
export function coverageText(coverage: ProfileDto["coverage"]): string | null {
  if (coverage === null) return null;
  return `Followers: ${lowerFirst(coverageDetail(coverage.followers))}. Following: ${lowerFirst(
    coverageDetail(coverage.following),
  )}.`;
}

export interface CardStat {
  key: "followers" | "following" | "mutuals" | "notFollowingBack";
  label: string;
  /** `null` is shown as "Unknown", never as zero. */
  value: number | null;
}

export function profileStats(metrics: ProfileDto["metrics"]): CardStat[] {
  return [
    { key: "followers", label: "Followers", value: metrics?.followers ?? null },
    { key: "following", label: "Following", value: metrics?.following ?? null },
    { key: "mutuals", label: "Mutuals", value: metrics?.mutuals ?? null },
    { key: "notFollowingBack", label: "Not following back", value: metrics?.notFollowingBack ?? null },
  ];
}

export interface CardExtras {
  /** Count history of the profile, when it was loaded. */
  counts: CountHistoryDto | null;
  /** Time of the newest "import processed" activity entry, or null. */
  lastProcessedAt: string | null;
  /** IANA timezone of the signed-in user. */
  timeZone: string;
  /** The time of the request: the clock the age of the export is measured against. */
  now: Date;
}

export interface CardState {
  title: string;
  detail: string;
}

export interface CardFailure {
  title: string;
  /** When it failed, and the fixed reason code when one was stored. */
  failed: string;
  /** The last successful result, stated on its own. */
  lastSuccess: string;
}

export interface CountTrend {
  label: "Followers" | "Following";
  points: SparkPoint[];
}

export interface ProfileCardModel {
  id: string;
  handle: string;
  profileHref: string;
  importHref: string;
  hasImport: boolean;
  /** The evidence status, and "Stale" when an export with incomplete coverage is also old or undated. */
  badges: StatusBadge[];
  /** One statement per badge. */
  notes: string[];
  stats: CardStat[];
  sourceLine: string;
  coverage: string | null;
  facts: Array<{ label: string; value: string }>;
  processing: CardState | null;
  failure: CardFailure | null;
  paused: CardState | null;
  /** True when the current export is old or undated, whatever its coverage. */
  stale: boolean;
  trend: CountTrend | null;
  netChanges: Array<{ label: "Followers" | "Following"; text: string }>;
}

const NONE_YET = "None yet";

function when(value: string | null, timeZone: string): string {
  return value === null ? NONE_YET : formatLocalTime(value, timeZone);
}

/** True while the newest failure has no later success. */
function failureStands(profile: Pick<ProfileDto, "lastFailureAt" | "lastSuccessAt">): boolean {
  if (profile.lastFailureAt === null) return false;
  if (profile.lastSuccessAt === null) return true;
  return new Date(profile.lastFailureAt).getTime() > new Date(profile.lastSuccessAt).getTime();
}

export function profileFailure(
  profile: Pick<ProfileDto, "lastFailureAt" | "lastFailureCode" | "lastSuccessAt">,
  timeZone: string,
): CardFailure | null {
  if (!failureStands(profile)) return null;
  const code = profile.lastFailureCode ? ` Reason code: ${profile.lastFailureCode}.` : "";
  return {
    title: "The last background job failed",
    failed: `Failed on ${formatLocalTime(profile.lastFailureAt, timeZone)}.${code}`,
    lastSuccess:
      profile.lastSuccessAt === null
        ? "There is no earlier successful result."
        : `Last successful result: ${formatLocalTime(profile.lastSuccessAt, timeZone)}. It is unchanged.`,
  };
}

export function profileProcessing(profile: Pick<ProfileDto, "processing" | "activeJob">): CardState | null {
  if (!profile.processing) return null;
  const retried = (profile.activeJob?.attempts ?? 0) > 1 || Boolean(profile.activeJob?.lastErrorCode);
  return {
    title: "Processing import",
    detail: retried
      ? "An import is stored and an earlier attempt to process it did not finish. It will be tried again. Until then this shows the last processed result."
      : "An import is stored and waiting to be processed. Until then this shows the last processed result.",
  };
}

export function profilePaused(profile: Pick<ProfileDto, "status" | "pausedAt">, timeZone: string): CardState | null {
  if (profile.status !== "paused") return null;
  const since = profile.pausedAt === null ? "" : ` on ${formatLocalTime(profile.pausedAt, timeZone)}`;
  return {
    title: "Scheduled reviews are paused",
    detail: `You paused this profile${since}. Stored imports are unchanged.`,
  };
}

/** The known counts of one direction, oldest first. A point with an unknown count is left out, never drawn as zero. */
export function countSeries(
  counts: CountHistoryDto,
  direction: "followers" | "following",
  timeZone: string,
): SparkPoint[] {
  const points: SparkPoint[] = [];
  for (const point of counts.points) {
    const value = point[direction];
    if (value !== null) points.push({ label: formatDate(point.capturedAt, timeZone), value });
  }
  return points;
}

/** The series for the small drawing: follower counts, or following counts when those are all unknown. */
export function countTrend(counts: CountHistoryDto | null, timeZone: string): CountTrend | null {
  if (counts === null) return null;
  for (const direction of ["followers", "following"] as const) {
    const points = countSeries(counts, direction, timeZone);
    if (points.length >= 2) return { label: direction === "followers" ? "Followers" : "Following", points };
  }
  return null;
}

/** The net change sentences exactly as the service worded them. A count change never names accounts. */
export function netChanges(counts: CountHistoryDto | null): ProfileCardModel["netChanges"] {
  const changes: ProfileCardModel["netChanges"] = [];
  if (counts?.followersChange) changes.push({ label: "Followers", text: counts.followersChange });
  if (counts?.followingChange) changes.push({ label: "Following", text: counts.followingChange });
  return changes;
}

export function profileFacts(
  profile: Pick<ProfileDto, "status" | "lastReviewAt" | "nextReviewAt">,
  extras: Pick<CardExtras, "lastProcessedAt" | "timeZone">,
): ProfileCardModel["facts"] {
  const next =
    profile.status === "paused"
      ? "Paused"
      : profile.nextReviewAt === null
        ? "Not scheduled"
        : formatLocalTime(profile.nextReviewAt, extras.timeZone);
  return [
    { label: "Last processed import", value: when(extras.lastProcessedAt, extras.timeZone) },
    { label: "Last successful review", value: when(profile.lastReviewAt, extras.timeZone) },
    { label: "Next scheduled review", value: next },
  ];
}

/** Everything one dashboard card shows for a profile. */
export function profileCard(profile: ProfileDto, extras: CardExtras): ProfileCardModel {
  return {
    id: profile.id,
    handle: profile.handle,
    profileHref: `/profiles/${profile.id}`,
    importHref: `/profiles/${profile.id}/import`,
    hasImport: profile.currentSnapshotId !== null,
    badges: statusBadges(profile, extras.now),
    notes: statusNotes(profile, extras.now),
    stats: profileStats(profile.metrics),
    sourceLine: sourceLine(profile, extras.timeZone),
    coverage: coverageText(profile.coverage),
    facts: profileFacts(profile, extras),
    processing: profileProcessing(profile),
    failure: profileFailure(profile, extras.timeZone),
    paused: profilePaused(profile, extras.timeZone),
    stale: staleNote(profile, extras.now) !== null,
    trend: countTrend(extras.counts, extras.timeZone),
    netChanges: netChanges(extras.counts),
  };
}

/** The banner above the cards: every profile whose current export is stale, or null when none is. */
export function staleBanner(cards: ReadonlyArray<Pick<ProfileCardModel, "handle" | "stale">>): CardState | null {
  const handles = cards.filter((card) => card.stale).map((card) => card.handle);
  if (handles.length === 0) return null;
  return {
    title: handles.length === 1 ? "One profile shows a stale export." : `${handles.length} profiles show a stale export.`,
    detail: `${handles.join(", ")}: the current export is more than ${STALE_HOURS} hours old or has no capture time. The numbers describe that export, not today. Request a new export from Instagram and import it to refresh them.`,
  };
}

/**
 * The id of the field of the add-profile form, the target of the link in the
 * empty state. It lives here, not in the form's own file: that file is a
 * client module, and a server component that imports a constant from a client
 * module receives a reference to it, not the text.
 */
export const ADD_PROFILE_FIELD_ID = "add-profile-handle";

/** The profile quota as the add-profile form states it. */
export function profileQuota(used: number, limit: number): { text: string; full: boolean } {
  const full = used >= limit;
  return {
    text: `${used} of ${limit} profiles used.${full ? " Remove a profile to add another." : ""}`,
    full,
  };
}
