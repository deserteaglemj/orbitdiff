import type { Metadata } from "next";
import Link from "next/link";

import { IDENTITY_SOURCE } from "@/components/capability-copy";
import { LegalDocument, type LegalSection } from "@/components/legal-document";
import { REPOSITORY_URL } from "@/components/site-footer";
import { formatCount } from "@/components/ui/format";
import { CONSENT_VERSIONS, LIMITS } from "@/domain/limits";
import { readOperatorName } from "@/server/env";

import { OperatorStatement } from "../operator-statement";

export const metadata: Metadata = {
  title: "Terms of use",
  description:
    "The rules for using OrbitDiff Web: what it is, what its results mean, its quotas, and how an account ends.",
};

const megabytes = (bytes: number) => formatCount(bytes / (1024 * 1024));
const minutes = (ms: number) => formatCount(ms / (60 * 1000));

/** `operatorName` is the configured OPERATOR_NAME, or null when no operator has been named. */
const buildSections = (operatorName: string | null): LegalSection[] => [
  {
    id: "operator",
    title: "Who operates this deployment",
    body: (
      <>
        <OperatorStatement operatorName={operatorName} />
        <p>In these terms, the operator is whoever runs this deployment of OrbitDiff Web.</p>
      </>
    ),
  },
  {
    id: "service",
    title: "What OrbitDiff Web is",
    body: (
      <>
        <p>
          OrbitDiff Web lets you import your own Instagram followers and following export and shows you mutuals, who
          does not follow back, what changed between two exports, and a daily review of how fresh your latest export
          is.
        </p>
        <p>
          Automatic follower and following identity tracking is unavailable. {IDENTITY_SOURCE} OrbitDiff Web never
          contacts Instagram and never asks for an Instagram password, verification code, cookie, or session.
        </p>
        <p>OrbitDiff Web is not affiliated with, endorsed by, or connected to Instagram or Meta.</p>
      </>
    ),
  },
  {
    id: "preview",
    title: "A free preview",
    body: (
      <>
        <p>
          OrbitDiff Web is a free, non-commercial preview. There is no paid tier, no advertising, and no commitment
          to availability. It may change, pause, or end.
        </p>
        <p>
          It runs on shared capacity with fixed limits. When a limit is reached, registration, imports, or scheduled
          reviews pause and the app says why. Nothing is charged when a limit is reached.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <ul>
        <li>An OrbitDiff account is separate from any Instagram account.</li>
        <li>You need an email address that you can verify. Keep your OrbitDiff password to yourself.</li>
        <li>An account is for one person. Do not create accounts by automated means.</li>
        <li>
          An account whose email address is not verified within {formatCount(LIMITS.retainUnverifiedAccountDays)}{" "}
          days is removed.
        </li>
      </ul>
    ),
  },
  {
    id: "exports",
    title: "The exports you import",
    body: (
      <>
        <ul>
          <li>
            Import only exports that you requested from Instagram for an account that is yours or that you are
            authorized to manage. Adding a handle as a profile is your declaration that this is the case.
          </li>
          <li>
            An export contains other people&apos;s usernames. Use what OrbitDiff Web shows you for your own review.
            Do not use it to harass anyone or to publish lists of accounts.
          </li>
          <li>The capture time and the completeness of each list are your declarations. Enter them truthfully.</li>
        </ul>
      </>
    ),
  },
  {
    id: "results",
    title: "What the results mean",
    body: (
      <>
        <ul>
          <li>
            A difference between two exports is an observation in your exports between two capture times. It is not
            a live follow or unfollow.
          </li>
          <li>
            Exports hold usernames only, so a renamed account cannot be proven to be the same account.
          </li>
          <li>
            A list is treated as complete only when you declared it complete, its files are all present, and its
            capture time is known. The declaration is not independently verified.
          </li>
          <li>A count change is net growth or net decline. It never names accounts.</li>
          <li>Unknown means the evidence does not support an answer. It does not mean zero.</li>
        </ul>
        <p>
          The results are only as accurate as the exports and declarations you supply. Do not rely on them for
          decisions that need certainty.
        </p>
      </>
    ),
  },
  {
    id: "quotas",
    title: "Quotas",
    body: (
      <>
        <ul>
          <li>{formatCount(LIMITS.profilesPerUser)} profiles per account.</li>
          <li>{formatCount(LIMITS.importsPerUserPerDay)} imports per account per day.</li>
          <li>{formatCount(LIMITS.accountsPerSnapshot)} usernames per export, both lists together.</li>
          <li>{formatCount(LIMITS.snapshotsPerProfile)} stored exports per profile.</li>
          <li>{megabytes(LIMITS.rosterBytesPerUser)} MB of stored usernames per account.</li>
          <li>
            {formatCount(LIMITS.manualReviewsPerProfilePerDay)} manual reviews per profile per day, at least{" "}
            {minutes(LIMITS.reviewCooldownMs)} minutes apart.
          </li>
          <li>{formatCount(LIMITS.resumesPerProfilePerDay)} resumes per profile per day. Pausing is never limited.</li>
          <li>
            Product news can be turned on {formatCount(LIMITS.marketingGrantsPerUserPerDay)} times per day. Turning it
            off is never limited.
          </li>
        </ul>
        <p>Do not try to get around a quota, for example by creating more accounts.</p>
      </>
    ),
  },
  {
    id: "use",
    title: "Acceptable use",
    body: (
      <ul>
        <li>Do not try to reach another account&apos;s profiles, imports, or results.</li>
        <li>Do not overload the service, probe it for weaknesses, or interfere with other people&apos;s use of it.</li>
        <li>Do not use the service in a way that breaks the law or Instagram&apos;s terms.</li>
      </ul>
    ),
  },
  {
    id: "ending",
    title: "Ending an account",
    body: (
      <>
        <p>
          You can delete your account at any time in Settings. Deleting it removes the account and everything stored
          for it. You can download your data from Settings first.
        </p>
        <p>
          An account that breaks these terms may be suspended. The preview may end. Download your data from Settings
          if you want to keep it.
        </p>
      </>
    ),
  },
  {
    id: "privacy",
    title: "Privacy and marketing consent",
    body: (
      <p>
        The <Link href="/legal/privacy" className="od-link">privacy notice</Link> says what is collected, why, and
        for how long. Marketing consent is separate from accepting these terms. It is optional and off unless you
        turn it on, and you can change it in Settings.
      </p>
    ),
  },
  {
    id: "warranty",
    title: "No warranty",
    body: (
      <p>
        OrbitDiff Web is provided as it is, without warranties of any kind, to the extent the law allows. The
        operator is not liable for decisions made on the basis of its results or for loss of stored data. Keep your
        original exports.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        The version at the top of this page is the date the text last changed. Your consent record keeps the version
        you accepted.
      </p>
    ),
  },
  {
    id: "source",
    title: "Local app, skill, and contact",
    body: (
      <p>
        Watching the public following list of another account is not part of OrbitDiff Web. It remains in the local
        Orbit OS app and the OrbitDiff Agent Skill, which are available from the{" "}
        <a href={REPOSITORY_URL} rel="noopener noreferrer" className="od-link">
          OrbitDiff repository on GitHub
        </a>
        . Questions about these terms can be raised there. Issues are public, so do not include personal data in
        one.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of use"
      version={CONSENT_VERSIONS.terms}
      summary="OrbitDiff Web is a free, non-commercial preview that works from the Instagram exports you import. These terms say what it does, what its results mean, and what is expected of you."
      sections={buildSections(readOperatorName())}
    />
  );
}
