import type { Metadata } from "next";
import Link from "next/link";

import { CapabilityNotice } from "@/components/capability-notice";
import { ImportFlow } from "@/components/import/import-flow";
import { PageHeader } from "@/components/ui";
import { getUserUsage } from "@/server/services/usage";

import { loadOwnedProfile } from "../load";

type Params = Promise<{ id: string }>;

/** The title belongs to the user's own profile only. Any other id gets the title of the not-found page. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  await loadOwnedProfile((await params).id);
  return { title: "Import an export" };
}

/**
 * The import screen of one profile. The export is read in the browser; this
 * page only supplies the handle, the account timezone for the capture time,
 * and today's import count. Any id that is not a profile of the signed-in user
 * ends on the not-found page (see loadOwnedProfile).
 */
export default async function ImportPage({ params }: { params: Params }) {
  const owned = await loadOwnedProfile((await params).id);
  // The layout shows the suspended notice in place of this page.
  if (owned === null) return null;
  const { user, profile } = owned;
  const now = new Date();
  const usage = await getUserUsage(user.id, now);
  // The daily import count is kept per UTC day.
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

  return (
    <>
      <p className="text-sm">
        <Link href={`/profiles/${profile.id}`} className="od-link inline-block py-1">
          Back to <span className="font-mono">{profile.handle}</span>
        </Link>
      </p>
      <PageHeader
        className="mt-3"
        title="Import an export"
        description={
          <>
            For <span className="font-mono text-ink">{profile.handle}</span>. Your export is read in this browser.
            Nothing here asks for an Instagram password, code, or session.
          </>
        }
      />
      <CapabilityNotice className="mt-6" />
      <div className="mt-8">
        <ImportFlow
          profileId={profile.id}
          handle={profile.handle}
          timeZone={user.timezone}
          snapshotCount={profile.snapshotCount}
          importsToday={usage.importsToday}
          importsPerDay={usage.importsPerDayLimit}
          importsResetAt={resetsAt}
        />
      </div>
    </>
  );
}
