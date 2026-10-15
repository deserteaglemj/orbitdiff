import Link from "next/link";

import { IDENTITY_SOURCE } from "@/components/capability-copy";
import { Container, MainContent } from "@/components/page-frame";
import { REPOSITORY_URL, SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  Badge,
  Card,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  formatCount,
  LinkButton,
  observedBetween,
  Sparkline,
  StatGrid,
  StatTile,
} from "@/components/ui";
import { LIMITS } from "@/domain/limits";

const EXPORT_HELP_URL = "https://help.instagram.com/181231772500920";

const STALE_HOURS = LIMITS.staleAfterMs / (60 * 60 * 1000);

/** Synthetic data for the example panel. None of these accounts are real. */
const EXAMPLE = {
  handle: "atlas_studio",
  followers: [
    { label: "8 Sep", value: 405 },
    { label: "15 Sep", value: 409 },
    { label: "22 Sep", value: 408 },
    { label: "29 Sep", value: 412 },
  ],
  following: 389,
  mutuals: 301,
  notFollowingBack: 88,
  accounts: [
    { username: "nova_labs", relationship: "Mutual", tone: "ok" },
    { username: "pixel_forge", relationship: "Not following back", tone: "warning" },
    { username: "ember_lab", relationship: "Follows you", tone: "info" },
  ],
} as const;

function ExampleProfile() {
  const latest = EXAMPLE.followers[EXAMPLE.followers.length - 1];
  return (
    <figure className="m-0">
      <Card className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-sm text-ink">{EXAMPLE.handle}</p>
          <Badge tone="ok">Current export</Badge>
        </div>
        <StatGrid columns={2}>
          <StatTile label="Followers" value={latest.value} tone="ground" />
          <StatTile label="Following" value={EXAMPLE.following} tone="ground" />
          <StatTile label="Mutuals" value={EXAMPLE.mutuals} tone="ground" />
          <StatTile label="Not following back" value={EXAMPLE.notFollowingBack} tone="ground" />
        </StatGrid>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="text-sm text-muted">
            Followers across four exports
            <span className="block text-ink">Net growth of 4 since the previous export</span>
          </p>
          <Sparkline points={[...EXAMPLE.followers]} />
        </div>
        <DataTable caption="Three accounts from the example export" captionHidden>
          <DataTableHead>
            <DataTableHeaderCell>Username</DataTableHeaderCell>
            <DataTableHeaderCell align="right">Relationship</DataTableHeaderCell>
          </DataTableHead>
          <DataTableBody>
            {EXAMPLE.accounts.map((account) => (
              <DataTableRow key={account.username}>
                <DataTableCell label="Username" rowHeader className="font-mono">
                  {account.username}
                </DataTableCell>
                <DataTableCell label="Relationship" align="right">
                  <Badge tone={account.tone}>{account.relationship}</Badge>
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </Card>
      <figcaption className="mt-3 text-sm text-muted">
        Example with made-up accounts. Your results come only from the exports you import.
      </figcaption>
    </figure>
  );
}

const SECTION = "py-14 sm:py-20";
const H2 = "text-2xl font-bold tracking-tight text-ink sm:text-3xl";
const LEAD = "mt-3 max-w-[65ch] text-muted";
const H3 = "text-lg font-semibold text-ink";
const BODY = "mt-2 text-sm text-muted";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <MainContent>
        <Container>
          <section
            aria-labelledby="hero-title"
            className="grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16 lg:py-20"
          >
            <div>
              <h1 id="hero-title" className="text-4xl leading-[1.1] font-bold tracking-tight text-balance text-ink sm:text-5xl lg:text-[2.5rem] xl:text-[2.875rem]">
                See who follows you back, from your own export.
              </h1>
              <p className="mt-5 max-w-[52ch] text-lg text-muted">
                Import your own Instagram export to see mutuals, who does not follow back, and what changed between
                two exports.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <LinkButton href="/sign-up" variant="primary" size="lg">
                  Create account
                </LinkButton>
                <LinkButton href="/sign-in" variant="secondary" size="lg">
                  Sign in
                </LinkButton>
              </div>
            </div>
            <ExampleProfile />
          </section>

          <section aria-labelledby="does-title" className={`${SECTION} border-t border-line`}>
            <h2 id="does-title" className={H2}>
              What OrbitDiff Web does
            </h2>
            <p className={LEAD}>
              It reads the followers and following lists in an export you request from Instagram yourself, and keeps
              a dated history of what each export showed.
            </p>
            <div className="mt-8 grid gap-4 lg:grid-cols-6">
              <Card as="article" className="flex flex-col lg:col-span-4">
                <h3 className={H3}>Import your own export</h3>
                <p className={BODY}>
                  Choose the export ZIP, or the followers and following JSON files inside it. The first import for a
                  profile is a baseline and lists no changes.
                </p>
                <ul className="mt-auto flex flex-wrap gap-2 pt-4 font-mono text-xs text-ink">
                  <li className="rounded-md border border-line bg-ground px-2 py-1">followers_1.json</li>
                  <li className="rounded-md border border-line bg-ground px-2 py-1">following.json</li>
                </ul>
              </Card>
              <Card as="article" tone="blue" className="flex flex-col lg:col-span-2">
                <h3 className={H3}>Mutuals and who does not follow back</h3>
                <p className="mt-2 text-sm text-ink">
                  Every account in your export is labelled. Unknown means the export cannot prove that someone is
                  absent from a list.
                </p>
                <ul className="mt-auto flex flex-wrap gap-2 pt-4">
                  <li>
                    <Badge tone="ok">Mutual</Badge>
                  </li>
                  <li>
                    <Badge tone="warning">Not following back</Badge>
                  </li>
                  <li>
                    <Badge tone="info">Follows you</Badge>
                  </li>
                  <li>
                    <Badge tone="neutral">Unknown</Badge>
                  </li>
                </ul>
              </Card>
              <Card as="article" className="flex flex-col lg:col-span-2">
                <h3 className={H3}>What changed between two exports</h3>
                <p className={BODY}>
                  Import a later export and see which usernames appeared in or disappeared from each list. Every
                  change is worded as an observation between two dates, for example:
                </p>
                <div className="h-4" aria-hidden="true" />
                <p className="mt-auto border-l-2 border-green pl-3 text-sm text-ink">
                  <span className="font-mono">ember_lab</span> appeared in your followers,{" "}
                  {observedBetween("2026-09-22T12:00:00+00:00", "2026-09-29T12:00:00+00:00")}.
                </p>
              </Card>
              <Card as="article" tone="raised" className="flex flex-col lg:col-span-4">
                <h3 className={H3}>A daily review of how fresh your evidence is</h3>
                <p className="mt-2 text-sm text-ink">
                  Once a day, at the hour you choose, OrbitDiff Web checks the age and the coverage of your latest
                  export. An export older than {STALE_HOURS} hours, or one without a capture time, is marked stale. The
                  review reads what you imported. It does not contact Instagram.
                </p>
                <ul className="mt-auto flex flex-wrap gap-2 pt-4">
                  <li>
                    <Badge tone="ok">Current</Badge>
                  </li>
                  <li>
                    <Badge tone="warning">Stale</Badge>
                  </li>
                  <li>
                    <Badge tone="warning">Coverage incomplete</Badge>
                  </li>
                  <li>
                    <Badge tone="neutral">No import yet</Badge>
                  </li>
                </ul>
              </Card>
            </div>
          </section>

          <section id="cannot-do" aria-labelledby="cannot-title" className={`${SECTION} border-t border-line`}>
            <h2 id="cannot-title" className={H2}>
              What it cannot do
            </h2>
            <p className={LEAD}>These limits are part of the product, not a temporary gap.</p>
            <dl className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <dt className="border-l-2 border-amber pl-4 text-lg font-semibold text-ink">
                Automatic follower and following identity tracking is unavailable.
              </dt>
              <dd className="text-muted">
                {IDENTITY_SOURCE} OrbitDiff Web never asks for an Instagram password, verification code, cookie, or
                session, and it never contacts Instagram. It knows only what is in the exports you import.
              </dd>
              <dt className="border-l-2 border-amber pl-4 text-lg font-semibold text-ink">Counts are counts.</dt>
              <dd className="text-muted">
                A follower count that moves from 100 to 103 is net growth of 3. A count never names the accounts
                behind it, and it is shown only where your export covers the whole list.
              </dd>
              <dt className="border-l-2 border-amber pl-4 text-lg font-semibold text-ink">
                A difference between two exports is not a live event.
              </dt>
              <dd className="text-muted">
                It shows that a username was in one export and not in the other. Exports hold usernames only, so a
                renamed account looks like one account leaving and another arriving. Whether a list is complete is
                your declaration and is not independently verified.
              </dd>
              <dt className="border-l-2 border-amber pl-4 text-lg font-semibold text-ink">
                Public following-list watchlists are not part of the hosted app.
              </dt>
              <dd className="text-muted">
                Watching the public following list of another account remains in the local Orbit OS app and the
                OrbitDiff Agent Skill, which run on your own computer.{" "}
                <a href={REPOSITORY_URL} rel="noopener noreferrer" className="od-link">
                  Local app and skill on GitHub
                </a>
                .
              </dd>
            </dl>
          </section>

          <section aria-labelledby="import-title" className={`${SECTION} border-t border-line`}>
            <h2 id="import-title" className={H2}>
              How the import works
            </h2>
            <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-16">
              <ol className="grid gap-7">
                <li>
                  <h3 className={H3}>Request your export from Instagram</h3>
                  <p className={BODY}>
                    Ask Instagram for a download of your information that includes followers and following, in JSON
                    format.{" "}
                    <a href={EXPORT_HELP_URL} rel="noopener noreferrer" className="od-link">
                      Instagram explains how to export your information
                    </a>
                    .
                  </p>
                </li>
                <li>
                  <h3 className={H3}>Choose the export in your browser</h3>
                  <p className={BODY}>
                    Your export is read in your browser. The file itself is not uploaded, and everything in it other
                    than the followers and following lists is ignored.
                  </p>
                </li>
                <li>
                  <h3 className={H3}>Enter the capture time and declare completeness</h3>
                  <p className={BODY}>
                    You enter when the export was captured and say whether each list is complete. Both are shown as
                    your declarations wherever results depend on them.
                  </p>
                </li>
                <li>
                  <h3 className={H3}>Read your lists</h3>
                  <p className={BODY}>
                    The import is processed in the background. If processing fails, the failure is shown next to the
                    last successful result and never replaces it.
                  </p>
                </li>
              </ol>
              <Card as="section" className="self-start">
                <h3 className={H3}>Only this is sent</h3>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink">
                  <li>Follower and following usernames</li>
                  <li>Shard numbers: which numbered export files each list came from</li>
                  <li>The capture time you enter</li>
                  <li>Your completeness declarations</li>
                </ul>
                <p className="mt-3 text-sm text-muted">They are stored under the profile handle you added.</p>
                <h3 className={`${H3} mt-6`}>Never requested</h3>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink">
                  <li>Instagram passwords, verification codes, cookies, or sessions</li>
                  <li>Messages, contacts, or posts</li>
                </ul>
              </Card>
            </div>
          </section>

          <section aria-labelledby="preview-title" className={`${SECTION} border-t border-line`}>
            <h2 id="preview-title" className={H2}>
              A free preview with stated limits
            </h2>
            <p className={LEAD}>
              OrbitDiff Web is free and non-commercial. When a quota or the shared capacity is used up, the affected
              action pauses and says why. There is no paid tier.
            </p>
            <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
              <div>
                <dt className="text-sm text-muted">Profiles per account</dt>
                <dd className="mt-1 text-3xl font-semibold text-ink tabular-nums">
                  {formatCount(LIMITS.profilesPerUser)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Imports per day</dt>
                <dd className="mt-1 text-3xl font-semibold text-ink tabular-nums">
                  {formatCount(LIMITS.importsPerUserPerDay)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Stored exports per profile</dt>
                <dd className="mt-1 text-3xl font-semibold text-ink tabular-nums">
                  {formatCount(LIMITS.snapshotsPerProfile)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Usernames per export</dt>
                <dd className="mt-1 text-3xl font-semibold text-ink tabular-nums">
                  {formatCount(LIMITS.accountsPerSnapshot)}
                </dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="start-title"
            className="grid gap-8 rounded-xl border border-line bg-surface p-6 sm:p-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-16"
          >
            <div>
              <h2 id="start-title" className={H2}>
                Start with one export
              </h2>
              <p className="mt-3 max-w-[52ch] text-muted">
                An OrbitDiff account is separate from your Instagram account and needs a verified email address. When
                registration is paused, the sign-up page says so.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <LinkButton href="/sign-up" variant="primary" size="lg">
                  Create account
                </LinkButton>
                <LinkButton href="/sign-in" variant="secondary" size="lg">
                  Sign in
                </LinkButton>
              </div>
            </div>
            <div className="lg:border-l lg:border-line lg:pl-10">
              <h3 className={H3}>Before you sign up</h3>
              <p className={BODY}>
                Read what is stored, for how long, and how to export or delete it in the{" "}
                <Link href="/legal/privacy" className="od-link">
                  privacy notice
                </Link>
                , and the rules for using the preview in the{" "}
                <Link href="/legal/terms" className="od-link">
                  terms
                </Link>
                .
              </p>
            </div>
          </section>
        </Container>
      </MainContent>
      <SiteFooter />
    </>
  );
}
