import { CapabilityNotice } from "@/components/capability-notice";
import { buttonClasses, EmptyState, Notice, PageHeader, Panel, SectionHeading } from "@/components/ui";
import type { ActivityDto, Page, ScheduleStateDto } from "@/server/services/contracts";

import { ActivityFeed } from "./activity-feed";
import { ACTIVITY_ANCHOR, type ActivityQuery } from "./activity-model";
import { AddProfileForm } from "./add-profile-form";
import { ADD_PROFILE_FIELD_ID, type ProfileCardModel, schedulePause, staleBanner } from "./card-model";
import { zoneLabel } from "./local-time";
import { ProfileCard } from "./profile-card";

export interface DashboardScreenProps {
  timeZone: string;
  cards: ProfileCardModel[];
  quota: { used: number; limit: number };
  activity: { query: ActivityQuery; page: Page<ActivityDto> };
  /** Whether scheduled work runs or is paused at the daily job capacity. */
  schedule?: ScheduleStateDto | null;
}

const DASHBOARD = "/dashboard";

/**
 * The dashboard: the standing notice about what the hosted app can know, one
 * card per profile, the form that adds a profile, and the activity feed. A
 * page without a profile leads to adding one and then to importing.
 */
export function DashboardScreen({ timeZone, cards, quota, activity, schedule = null }: DashboardScreenProps) {
  const stale = staleBanner(cards);
  const paused = schedulePause(schedule, timeZone);
  const firstWithoutImport = cards.find((card) => !card.hasImport)?.id ?? null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`What your imported exports show for each profile, and what happened to them. Times are in ${zoneLabel(timeZone)}.`}
      />
      <CapabilityNotice className="mt-6" />

      {paused ? (
        <Notice tone="info" label="Paused" className="mt-4" title={paused.title}>
          <p>{paused.detail}</p>
        </Notice>
      ) : null}

      {stale ? (
        <Notice tone="warning" className="mt-4" title={stale.title}>
          <p>{stale.detail}</p>
        </Notice>
      ) : null}

      <section aria-labelledby="profiles-heading" className="mt-10">
        <SectionHeading id="profiles-heading" title="Profiles" />
        {cards.length === 0 ? (
          <EmptyState
            className="mt-5"
            title="No profiles yet"
            description="Start by adding the Instagram account whose export you will import. Then request your followers and following export from Instagram in JSON format and import it from the profile. The first import is stored as a baseline."
            action={
              // A plain fragment link: the browser scrolls to the field and moves focus to it.
              <a href={`#${ADD_PROFILE_FIELD_ID}`} className={buttonClasses({ variant: "secondary" })}>
                Go to Add a profile
              </a>
            }
          />
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {cards.map((card) => (
              <ProfileCard key={card.id} card={card} primaryImport={card.id === firstWithoutImport} />
            ))}
          </div>
        )}
      </section>

      <Panel
        className="mt-10"
        title="Add a profile"
        description="A profile names the Instagram account whose exports you import. Adding it contacts nobody, and nothing here asks for an Instagram password, code, or session."
      >
        <div className="max-w-xl">
          <AddProfileForm used={quota.used} limit={quota.limit} timeZone={timeZone} primary={cards.length === 0} />
        </div>
      </Panel>

      <section aria-labelledby={ACTIVITY_ANCHOR} className="mt-10">
        <SectionHeading
          id={ACTIVITY_ANCHOR}
          title="Activity"
          description="Imports, processing results, reviews, and failures. A failure is listed as its own entry next to the last successful result."
        />
        <div className="mt-5">
          <ActivityFeed
            path={DASHBOARD}
            query={activity.query}
            page={activity.page}
            timeZone={timeZone}
            profiles={cards.map((card) => ({ id: card.id, handle: card.handle }))}
          />
        </div>
      </section>
    </>
  );
}
