import type { ReactNode } from "react";

import { TEXT_LINK } from "@/components/auth/auth-parts";
import { PageHeader, Panel } from "@/components/ui";
import type { MeDto } from "@/server/services/contracts";

import { ConsentRecord } from "./consent-record";
import { DataSection } from "./data-section";
import { DeleteAccountForm } from "./delete-account-form";
import { MarketingForm } from "./marketing-form";
import { ProfileForm, ReviewSchedule, type ScheduledProfile } from "./profile-form";
import { SecuritySection } from "./security-section";
import { timezoneLabel } from "./timezones";

export interface SettingsScreenProps {
  /** The signed-in account, from getMe() with the id the guards returned. */
  me: MeDto;
  /** The timezones the server accepts, UTC first. */
  timezones: string[];
  /** The versions of the documents this page shows. A product news grant names `marketing`. */
  versions: { terms: string; privacy: string; marketing: string };
  /** The profiles of the account with the time of their next daily review. */
  profiles: ScheduledProfile[];
}

const SECTIONS = [
  { id: "profile", title: "Profile" },
  { id: "communication", title: "Communication" },
  { id: "consent", title: "Consent record" },
  { id: "security", title: "Security" },
  { id: "data", title: "Your data" },
  { id: "delete", title: "Delete account" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const titleOf = (id: SectionId) => SECTIONS.find((entry) => entry.id === id)?.title ?? "";

function Section({ id, description, children }: { id: SectionId; description: string; children: ReactNode }) {
  return (
    <section id={id}>
      <Panel title={titleOf(id)} description={description}>
        {children}
      </Panel>
    </section>
  );
}

/**
 * The settings of one OrbitDiff account: profile, product news, the consent
 * record, security, the stored data, and account deletion. Every time on the
 * page is shown in the account's own timezone.
 *
 * The page hands this screen plain data. Each form calls a route of this app
 * or the auth client and shows that route's own message when it refuses.
 * Nothing here asks for anything about an Instagram login.
 */
export function SettingsScreen({ me, timezones, versions, profiles }: SettingsScreenProps) {
  return (
    <>
      <PageHeader
        title="Settings"
        description={`For the OrbitDiff account ${me.email}. An OrbitDiff account is separate from any Instagram account, and nothing on this page asks for an Instagram password, code, or login. Times are shown in your timezone, ${timezoneLabel(me.timezone)}.`}
      />
      <nav aria-label="Settings sections" className="mt-6">
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {SECTIONS.map((entry) => (
            <li key={entry.id}>
              <a href={`#${entry.id}`} className={TEXT_LINK}>
                {entry.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 grid gap-8">
        <Section
          id="profile"
          description="Your display name, your timezone, and the local hour of the daily review."
        >
          <div className="grid gap-8">
            <ProfileForm account={{ name: me.name, timezone: me.timezone, reviewHour: me.reviewHour }} timezones={timezones} />
            <div className="border-t border-line pt-6">
              <ReviewSchedule profiles={profiles} timeZone={me.timezone} />
            </div>
          </div>
        </Section>

        <Section
          id="communication"
          description="Product news is optional and separate from the Terms and the Privacy notice. Using OrbitDiff Web does not depend on it."
        >
          <MarketingForm recorded={me.consent.marketing} version={versions.marketing} timeZone={me.timezone} />
        </Section>

        <Section
          id="consent"
          description="What you accepted, in which version, and when. Read only."
        >
          <ConsentRecord consent={me.consent} versions={versions} timeZone={me.timezone} />
        </Section>

        <Section id="security" description="Your OrbitDiff password and the devices that are signed in.">
          <SecuritySection email={me.email} name={me.name} timeZone={me.timezone} />
        </Section>

        <Section id="data" description="Everything stored for your account, and how much of each quota you use.">
          <DataSection usage={me.usage} />
        </Section>

        <Section id="delete" description="Remove this OrbitDiff account and everything stored for it.">
          <DeleteAccountForm email={me.email} />
        </Section>
      </div>
    </>
  );
}
