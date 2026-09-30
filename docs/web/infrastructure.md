# OrbitDiff Web infrastructure, limits, and cost

Checked 2026-09-30. Budget for new spending: $0. Every tier below stops or rejects at its limit. None bills automatically, and no card is on file.

## Choice

| Piece | Service | Plan | Why |
| --- | --- | --- | --- |
| Web app and API | Vercel, the owner's team `<team-slug>` (Hobby), new project `orbitdiff-web` | Hobby | Already authorized. Free. No payment method on the team, so usage cannot be billed. |
| Database | Postgres, **not provisioned** | none | The owner ruled out a Vercel Marketplace database on 2026-09-30. The app needs a Postgres connection string in `DATABASE_URL`. Until one is configured the deployment serves public pages only and reports the database as not configured. |
| Hourly job tick | GitHub Actions scheduled workflow on the public repository | Free for public repositories | Hobby cron can run only once per day, so it is not the scheduler. |
| Mail | None in production; captured in staging | none | There is no OrbitDiff sending domain. |

Not used: the Supabase and Resend resources on the team (they belong to another project), any Marketplace database, any paid plan, any trial.

Local development and every automated test run against a real throwaway Postgres 18 started by the test runner, so the application is verified against Postgres without any hosted database.

## Compared with doing nothing new

| Dimension | OrbitDiff Web (hosted) | Existing local Orbit OS app |
| --- | --- | --- |
| Monthly cost | $0 inside the limits below | $0 |
| RAM | Vercel function instance 2 GB (fixed on Hobby). The database's memory depends on the Postgres the owner chooses. Nothing on the owner's machine. | The owner's machine, only while the app is open. |
| CPU | 1 vCPU per function instance, 4 active CPU hours per month. | The owner's CPU. |
| Storage | Whatever the chosen Postgres allows; the app caps itself at `CAPACITY_MAX_DB_BYTES` (default 400 MB). | Local disk. |
| Requests | 1,000,000 function invocations and 1,000,000 CDN requests per month. | Loopback only. |
| Scheduling | Hourly, best effort, from GitHub Actions. | None by design. |
| Users | Many, each isolated. | One. |
| Reach | Public URL. | `127.0.0.1` only. |
| Instagram contact | None. | Optional local session for public following lists. |

## Provider limits

| Limit | Value | At the limit |
| --- | --- | --- |
| Vercel function invocations | 1,000,000 per month | Feature pauses until the window resets. No purchase path on Hobby. |
| Vercel active CPU | 4 hours per month | Same. |
| Vercel provisioned memory | 360 GB-hours per month | Same. |
| Vercel function duration | 300 seconds | Request ends. |
| Vercel request body | 4.5 MB | HTTP 413. Exports are therefore parsed in the browser. |
| Vercel cron on Hobby | Once per day per expression, inside a 59 minute window | A more frequent expression fails the deploy. |
| Vercel Hobby use | Personal, non-commercial | Commercial use needs a paid plan. OrbitDiff Web takes no payment and shows no ads. |
| GitHub Actions | Free on standard runners for public repositories; shortest interval 5 minutes | Runs may be delayed or dropped under load; scheduled workflows are disabled after 60 days without repository activity and must be re-enabled. |

Sources: https://vercel.com/docs/plans/hobby , https://vercel.com/docs/limits , https://vercel.com/docs/functions/limitations , https://vercel.com/docs/cron-jobs/usage-and-pricing , https://vercel.com/docs/limits/fair-use-guidelines , https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows , https://docs.github.com/en/billing/concepts/product-billing/github-actions

## Limits the app enforces itself

These keep the app well inside the provider limits. They live in `web/src/domain/limits.ts` and three configuration values.

| Limit | Value |
| --- | --- |
| Registered users | `CAPACITY_MAX_USERS`, default 250. Registration pauses visibly at the limit. |
| Jobs per UTC day | `CAPACITY_MAX_JOBS_PER_DAY`, default 2,000. Scheduled work pauses visibly at the limit. |
| Database size | `CAPACITY_MAX_DB_BYTES`, default 400 MB. Set it below the chosen database plan limit. Imports pause visibly at the limit. |
| Profiles per user | 3 |
| Usernames per export snapshot | 50,000 |
| Export snapshots per profile | 30 |
| Stored roster bytes per user | 20 MB |
| Imports per user per day | 10 |
| Import request body | 3 MB |
| Manual reviews per profile per day | 3, at least 30 minutes apart |
| Job attempts | 3, with 5 and 30 minute backoff |
| Jobs per tick | 25, three at a time, inside 45 seconds |
| Retention | Finished jobs 90 days, activity 400 days, unverified accounts 7 days, captured mail 7 days |

## Expected usage

Assumptions: three profiles per user, one scheduled review per profile per day, one import per profile per week, an hourly tick, two dashboard visits per user per day. Jobs make no outbound request. A review reads a few rows; a derive job reads the profile's snapshots and rewrites its derived rows.

| Per month | 10 users | 100 users | 250 users (registration cap) |
| --- | --- | --- | --- |
| Tick invocations | 720 | 720 | 720 |
| Review jobs | 900 | 9,000 | 22,500 |
| Derive jobs | 130 | 1,300 | 3,250 |
| Function invocations | about 3,500 | about 28,000 | about 70,000 |
| Active CPU | under 0.1 hours | about 0.5 hours | about 1.2 hours |
| Stored data, typical 2,000 usernames per snapshot | about 10 MB | about 100 MB | about 250 MB |
| Cost | $0 | $0 | $0 |

Database compute and storage depend on the Postgres the owner chooses, so they are not estimated here. For reference only, the free Neon tier that was evaluated and not installed allows 0.5 GB and 100 compute-unit hours per month and suspends instead of billing; on a tier like that, database compute would be the first limit reached, at roughly 100 to 250 users. The registration cap of 250 is a deliberate ceiling. Raising it is an operator decision, not a default.

## Worst case: every job retries three times

| Per month | 10 users | 100 users | 250 users |
| --- | --- | --- | --- |
| Job attempts | about 3,100 | about 31,000 | about 77,000 |
| Attempts per day | about 100 | about 1,000 | capped at 2,000 by `CAPACITY_MAX_JOBS_PER_DAY` |
| Extra function invocations | none, the tick drains in-process | none | none |
| Outbound requests | none | none | none |
| Cost | $0 | $0 | $0, scheduled work pauses at the daily cap |

A caller that hit the tick endpoint once per second would use 1,000,000 invocations in about 12 days. On Hobby that pauses the feature. It cannot bill. The endpoint also requires the secret, so an anonymous caller is rejected before any work.

## Stop-before-overage summary

- Vercel Hobby: pauses, cannot bill (no payment method, no purchase path).
- Database: not provisioned, so it cannot bill. Whatever is chosen later must be checked for the same stop-before-overage behaviour before it is connected.
- GitHub Actions on a public repository: free; failure mode is delay or a skipped run.
- The app's own caps pause registration, scheduled work, and imports first, with a visible reason.

## What needs a human

- Choose and connect a Postgres database (set `DATABASE_URL`, and `DATABASE_URL_UNPOOLED` when the provider has a separate direct connection). This is the one thing blocking a working hosted deployment. Marketplace databases are ruled out by the owner.
- A sending domain, if registration is ever opened to the public.
- Merging the workflow file to the default branch, because GitHub starts scheduled runs only from there.
