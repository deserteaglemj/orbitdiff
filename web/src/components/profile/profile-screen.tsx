import Link from "next/link";
import type { ReactNode } from "react";

import { CapabilityNotice } from "@/components/capability-notice";
import {
  coverageText,
  evidenceNote,
  profileFacts,
  profileFailure,
  profilePaused,
  profileProcessing,
  profileStats,
  schedulePause,
  shownExport,
  sourceLine,
  staleNote,
  statusBadges,
  type StatusBadge,
} from "@/components/dashboard/card-model";
import { formatLocalTime } from "@/components/dashboard/local-time";
import { FactList } from "@/components/dashboard/profile-card";
import { cx, Notice, StatGrid, StatTile } from "@/components/ui";
import type { ProfileDto, ScheduleStateDto } from "@/server/services/contracts";

import { ProcessingWatcher } from "./processing-watcher";
import { ProfileHeader } from "./profile-header";
import { PROFILE_TABS, type ProfileTab, tabHref } from "./rows";

/** The id of the open section. Links that change its filters or its page scroll to it. */
export const SECTION_ANCHOR = "section";

export function importHrefOf(profileId: string): string {
  return `/profiles/${profileId}/import`;
}

/**
 * A profile page: the header with its actions, the standing notice, the state
 * of the evidence, the numbers of the last processed import, and the open
 * section. A failed job is a notice of its own next to those numbers. It does
 * not replace them. The age of the export and its coverage are two statements:
 * an old or undated export is called stale whether or not its coverage is
 * complete.
 */
export function ProfileScreen({
  profile,
  timeZone,
  lastProcessedAt,
  tab,
  now,
  schedule = null,
  children,
}: {
  profile: ProfileDto;
  timeZone: string;
  /** Time of the newest "import processed" activity entry, or null. */
  lastProcessedAt: string | null;
  tab: ProfileTab;
  /** The time of the request: the clock the age of the export is measured against. */
  now: Date;
  /** Whether scheduled work runs or is paused at the daily job capacity. */
  schedule?: ScheduleStateDto | null;
  /** The open section. */
  children: ReactNode;
}) {
  const importHref = importHrefOf(profile.id);
  // The badge, the age, and the source line describe the export the numbers below come from.
  const shown = shownExport(profile);
  const failure = profileFailure(profile, timeZone, lastProcessedAt);
  const paused = profilePaused(profile, timeZone);
  const scheduleNotice = profile.status === "paused" ? null : schedulePause(schedule, timeZone);
  const processing = profileProcessing(profile, timeZone);
  const coverage = coverageText(profile.coverage);
  const stale = staleNote(shown, now);
  const badges: StatusBadge[] = [
    ...statusBadges(shown, now),
    ...(processing ? [{ tone: "info" as const, text: processing.title }] : []),
    ...(paused ? [{ tone: "neutral" as const, text: "Paused" }] : []),
  ];
  const facts = [
    ...(coverage ? [{ label: "Coverage", value: coverage }] : []),
    { label: "Stored imports", value: String(profile.snapshotCount) },
    {
      label: "Last import received",
      value: profile.lastImportAt === null ? "None yet" : formatLocalTime(profile.lastImportAt, timeZone),
    },
    ...profileFacts(profile, { lastProcessedAt, timeZone, now, schedule }),
  ];
  const current = PROFILE_TABS.find((entry) => entry.id === tab) ?? PROFILE_TABS[0];

  return (
    <>
      <p className="text-sm">
        <Link href="/dashboard" className="od-link inline-block py-1">
          Back to the dashboard
        </Link>
      </p>
      <div className="mt-3">
        <ProfileHeader
          profileId={profile.id}
          handle={profile.handle}
          status={profile.status}
          sourceLine={sourceLine(shown, timeZone)}
          badges={badges}
          snapshotCount={profile.snapshotCount}
          timeZone={timeZone}
          importHref={importHref}
        />
      </div>
      <CapabilityNotice className="mt-4" />

      {failure ? (
        <Notice tone="danger" className="mt-4" title={failure.title}>
          <p>{failure.failed}</p>
          <p className="mt-1">{failure.lastSuccess}</p>
        </Notice>
      ) : null}
      {stale ? (
        <Notice tone="warning" className="mt-4" title="The current export is stale.">
          <p>{stale} The numbers below describe that export, not today.</p>
        </Notice>
      ) : null}
      {shown.evidence === "degraded" ? (
        <Notice tone="warning" className="mt-4" title="Coverage is incomplete.">
          <p>{evidenceNote("degraded")}</p>
        </Notice>
      ) : null}
      {paused ? (
        <Notice tone="info" label="Paused" className="mt-4" title={paused.title}>
          <p>{paused.detail} Resume the profile to schedule reviews again.</p>
        </Notice>
      ) : null}
      {scheduleNotice ? (
        <Notice tone="info" label="Paused" className="mt-4" title={scheduleNotice.title}>
          <p>{scheduleNotice.detail}</p>
        </Notice>
      ) : null}
      <ProcessingWatcher
        key={profile.lastImportAt ?? "none"}
        profileId={profile.id}
        processing={profile.processing}
        lastImportAt={profile.lastImportAt}
        detail={processing?.detail ?? ""}
      />

      <StatGrid className="mt-6">
        {profileStats(profile.metrics).map((stat) => (
          <StatTile key={stat.key} label={stat.label} value={stat.value} />
        ))}
      </StatGrid>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FactList facts={facts} />
        {profile.issues.length > 0 ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">Limits of this evidence</h2>
            <ul className="mt-2 grid list-disc gap-2 pl-5 text-sm text-ink">
              {profile.issues.map((issue) => (
                <li key={issue.code}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <nav aria-label="Profile sections" className="mt-10 border-b border-line">
        <ul className="-mb-px flex flex-wrap gap-x-1">
          {PROFILE_TABS.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`${tabHref(profile.id, entry.id)}#${SECTION_ANCHOR}`}
                aria-current={entry.id === tab ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-10 items-center rounded-t-lg border-b-2 px-3 text-sm transition-colors hover:bg-raised",
                  entry.id === tab
                    ? "border-blue font-semibold text-ink"
                    : "border-transparent font-medium text-muted hover:text-ink",
                )}
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby={SECTION_ANCHOR} className="mt-6">
        <h2 id={SECTION_ANCHOR} className="text-xl font-semibold tracking-tight text-ink">
          {current.label}
        </h2>
        <div className="mt-5">{children}</div>
      </section>
    </>
  );
}
