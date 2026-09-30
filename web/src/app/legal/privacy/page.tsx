import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument, type LegalSection } from "@/components/legal-document";
import { REPOSITORY_URL } from "@/components/site-footer";
import { formatCount } from "@/components/ui/format";
import { CONSENT_VERSIONS, LIMITS } from "@/domain/limits";
import { readOperatorName } from "@/server/env";

import { OperatorStatement } from "../operator-statement";

export const metadata: Metadata = {
  title: "Privacy notice",
  description:
    "What OrbitDiff Web collects and why, what it never collects, how long it keeps data, and how to export or delete it.",
};

/** `operatorName` is the configured OPERATOR_NAME, or null when no operator has been named. */
const buildSections = (operatorName: string | null): LegalSection[] => [
  {
    id: "who",
    title: "Who runs OrbitDiff Web",
    body: (
      <>
        <p>
          OrbitDiff Web is a free, non-commercial preview built from the open source OrbitDiff project. It shows no
          advertising and takes no payment.
        </p>
        <OperatorStatement operatorName={operatorName} />
        <p>
          OrbitDiff Web is not affiliated with, endorsed by, or connected to Instagram or Meta. An OrbitDiff account
          is separate from any Instagram account.
        </p>
      </>
    ),
  },
  {
    id: "collected",
    title: "What is collected and why",
    body: (
      <>
        <p>Only what the features below need. Nothing is collected to build a profile of you or to sell.</p>
        <dl>
          <dt>Email address</dt>
          <dd>
            To sign you in and to address account messages, such as email confirmation and password reset. This
            preview cannot deliver email yet. On a deployment where registration is open, those messages are stored
            instead of sent, and the operator can read them, including the links they contain. Where they are not
            stored, registration is closed.
          </dd>
          <dt>Password</dt>
          <dd>
            Your OrbitDiff password is stored only as a one-way hash. It is used to sign you in and to confirm that
            you want to delete your account. It is never your Instagram password.
          </dd>
          <dt>Display name</dt>
          <dd>
            Required when you sign up. It is shown inside the app so you can see which account you are signed in to.
          </dd>
          <dt>Timezone and review hour</dt>
          <dd>To schedule the daily review at the local hour you choose.</dd>
          <dt>Consent records</dt>
          <dd>
            Which version of the terms and of this notice you accepted, whether marketing consent is on, where you
            made each choice (sign-up, onboarding, or settings), and when. They are kept as a log so a past choice
            can be shown.
          </dd>
          <dt>Profile handles</dt>
          <dd>The Instagram handle of each account you add as a profile, so imports can be matched to it.</dd>
          <dt>The usernames in the exports you import</dt>
          <dd>
            These are other people&apos;s Instagram usernames: the accounts that follow you and the accounts you
            follow. They are stored only to show you your own relationship lists, which means mutuals, who does not
            follow back, and what changed between two of your exports. They are not combined across OrbitDiff
            accounts, not used to contact anyone, and not shared or sold.
          </dd>
          <dt>Details of each import</dt>
          <dd>
            The shard numbers of the export files, the capture time you enter, your completeness declarations, the
            time of the import, and a digest of the content that is used to recognise a duplicate import.
          </dd>
          <dt>Activity, background jobs, and usage counters</dt>
          <dd>
            A record of imports, reviews, and failures so the app can show you what happened, the jobs that process
            your imports, and daily counts of imports and reviews so quotas can be enforced.
          </dd>
          <dt>Sign-in sessions</dt>
          <dd>
            Each session records when it expires and the network address and browser description of the device that
            signed in. Requests to the sign-in endpoints are counted by network address for a short time to limit
            repeated attempts.
          </dd>
          <dt>Technical logs</dt>
          <dd>
            Server logs record requests and errors so faults can be found. They never contain tokens, cookies,
            passwords, or full email addresses. The hosting provider keeps its own request logs, which include
            network addresses. Security-relevant events, such as an account deletion, are recorded without personal
            data.
          </dd>
        </dl>
      </>
    ),
  },
  {
    id: "never",
    title: "What is never collected",
    body: (
      <>
        <ul>
          <li>Instagram passwords, verification codes, cookies, or sessions. OrbitDiff Web never asks for them.</li>
          <li>Messages, contacts, or posts.</li>
          <li>Anything from private profiles, and anything fetched from Instagram. OrbitDiff Web never contacts Instagram.</li>
          <li>
            The export file itself. It is read in your browser. Everything in it other than the followers and
            following lists is ignored and never leaves your device.
          </li>
          <li>Advertising identifiers or third-party analytics data. There are no such scripts on this site.</li>
        </ul>
      </>
    ),
  },
  {
    id: "import",
    title: "How an import is handled",
    body: (
      <>
        <p>
          Your export is read in your browser. Only the follower and following usernames it contains, the shard
          numbers, the capture time you enter, and your completeness declarations are sent to OrbitDiff Web, for the
          profile you chose. The server stores no uploaded files.
        </p>
        <p>
          Background jobs then work on what was stored: they compare your dated exports and record the daily review.
          They never contact Instagram.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        OrbitDiff Web uses cookies only to keep you signed in. They are sent over a secure connection and cannot be
        read by scripts. There are no advertising or analytics cookies.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long data is kept",
    body: (
      <>
        <ul>
          <li>Your account, settings, and consent records are kept until you delete your account.</li>
          <li>
            Imported exports are kept until you remove the profile or delete your account. A profile holds at most{" "}
            {formatCount(LIMITS.snapshotsPerProfile)} exports, and an account at most{" "}
            {formatCount(LIMITS.profilesPerUser)} profiles.
          </li>
          <li>
            Changes between exports are recalculated from your exports and limited to the most recent{" "}
            {formatCount(LIMITS.eventsPerProfile)} per profile.
          </li>
          <li>Activity entries are removed after {formatCount(LIMITS.retainActivityDays)} days.</li>
          <li>Finished background jobs are removed after {formatCount(LIMITS.retainJobsDays)} days.</li>
          <li>
            An account whose email address is never verified is removed after{" "}
            {formatCount(LIMITS.retainUnverifiedAccountDays)} days.
          </li>
          <li>
            Account messages that are stored instead of sent are removed after{" "}
            {formatCount(LIMITS.retainCapturedMailDays)} days.
          </li>
          <li>A sign-in session ends when you sign out, when it expires, or when you delete your account.</li>
        </ul>
      </>
    ),
  },
  {
    id: "choices",
    title: "Export, deletion, and your choices",
    body: (
      <>
        <dl>
          <dt>Export your data</dt>
          <dd>In Settings you can download everything stored for your account as a JSON file.</dd>
          <dt>Delete your account</dt>
          <dd>
            In Settings you can delete your account after entering your password. This removes the account and
            everything stored for it: profiles, imported exports, derived changes, activity, jobs, consent records,
            and sessions.
          </dd>
          <dt>Remove a profile</dt>
          <dd>Removing a profile deletes its imported exports and everything derived from them.</dd>
          <dt>Marketing consent</dt>
          <dd>
            Marketing consent is separate from accepting the terms and this notice. It is optional, it is off unless
            you turn it on, and you can change it in Settings at any time. Using OrbitDiff Web does not depend on
            it.
          </dd>
        </dl>
      </>
    ),
  },
  {
    id: "access",
    title: "Who can see your data",
    body: (
      <>
        <p>
          Your profiles, imports, and results are visible only to your own account. Another account that requests
          them gets the same answer as for something that does not exist.
        </p>
        <p>
          The operator has an admin view that lists accounts with their email address, display name, consent state,
          and usage counts, and has access to the database in order to run and repair the service.
        </p>
        <p>
          The operator can also read the account messages that are stored instead of sent, until they are removed.
          These are the email confirmation and password reset messages, and they contain the confirmation and reset
          links.
        </p>
        <p>
          The web application is hosted on Vercel. Account and import data is stored in the Postgres database
          configured for this deployment. A scheduled GitHub Actions workflow starts the hourly background
          processing and receives only job counts, never account data. Data is not sold and is not shared with
          anyone for their own purposes.
        </p>
      </>
    ),
  },
  {
    id: "preview",
    title: "Preview status",
    body: (
      <p>
        OrbitDiff Web is a free, non-commercial preview with quotas. When a quota or the shared capacity is
        exhausted, registration, imports, or scheduled reviews pause and the app says why. The{" "}
        <Link href="/legal/terms" className="od-link">
          terms
        </Link>{" "}
        list the quotas and say what happens when the preview pauses or ends.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this notice",
    body: (
      <p>
        The version at the top of this page is the date the text last changed. Your consent record keeps the version
        you accepted.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about this notice can be raised through the{" "}
        <a href={REPOSITORY_URL} rel="noopener noreferrer" className="od-link">
          OrbitDiff repository on GitHub
        </a>
        . Issues there are public, so do not include personal data in one.
      </p>
    ),
  },
];

/**
 * The operator name is read on its own, at request time (the legal layout opts
 * out of static rendering), so this page also renders on a deployment whose
 * other configuration is missing.
 */
export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy notice"
      version={CONSENT_VERSIONS.privacy}
      summary="OrbitDiff Web stores your sign-in details and the follower and following usernames from the exports you import, only to show you your own relationship lists. It never asks for Instagram credentials, and you can export or delete everything from Settings."
      sections={buildSections(readOperatorName())}
    />
  );
}
