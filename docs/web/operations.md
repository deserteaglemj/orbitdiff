# OrbitDiff Web operations

Checked 2026-09-30. This page is for the person who operates the hosted app in `web/`: what to configure, how registration opens, how background work is scheduled, what is not deployed, and the steps to deploy and to roll back.

Read [`design.md`](design.md) for the contract, [`capability-matrix.md`](capability-matrix.md) for what may be claimed, and [`infrastructure.md`](infrastructure.md) for limits and cost. Local setup is in [`web/README.md`](../../web/README.md).

## 1. What is not deployed, and why

There is no working hosted instance, and this page does not describe one.

| Missing | Why | What unblocks it |
| --- | --- | --- |
| A database | No Postgres is provisioned. The owner declined a Vercel Marketplace database on 2026-09-30, and the only free create path that was found goes through the marketplace and requires accepting its terms. | The owner chooses a Postgres and provides its connection string. Then follow section 5. |
| Production email | Sending mail to arbitrary addresses is not implemented. There are two transports: `capture`, which stores the message instead of sending it and is refused in production, and `none`. Real delivery needs a domain the operator controls. | A sending domain, DNS records for a mail provider, and a delivery transport in the code. |
| Open registration | Registration stays closed until an operator is named, in every stage. With no operator, no mail delivery, or no database, the health endpoint and the sign-up page say why. | See section 3. |
| Scheduled job runs | There is no deployment for the workflow to call. GitHub starts scheduled runs only from the default branch, and the workflow runs nothing until its two repository secrets are set. | A deployment, the workflow file on the default branch, and the two secrets. See section 4. |

Without a database the app serves its public pages only, `GET /api/health` answers 503 with `{ "status": "unconfigured", "missing": [...] }` (variable names, never values), and registration is closed.

Everything is verified locally instead: the automated tests run the whole app against a real throwaway Postgres 18, including the customer journeys in `web/tests/integration/journey`.

## 2. Configuration reference

Every variable is read and validated in `web/src/server/env.ts`. Validation is lazy, so a build needs none of them. An invalid or missing value is reported by name only; a configured value is never printed.

The placeholders below are shapes, not values. Generate every secret yourself, for example with `openssl rand -hex 32`, and never commit one.

| Variable | What it does | Secret | Placeholder |
| --- | --- | --- | --- |
| `APP_STAGE` | Which kind of deployment this is: `development`, `test`, `staging`, or `production`. Required, with no default. It decides which mail transport is allowed and whether the base URL must use https. | No | `staging` |
| `APP_BASE_URL` | The origin of the deployment. Links in mail, the same-origin check on every state-changing request, and the cookie settings use it. Must use https in `staging` and `production`. | No | `https://<your-host>` |
| `APP_COMMIT_SHA` | The revision that is running, shown by `GET /api/health`. Optional. Letters, digits, dot, underscore, and hyphen, at most 64 characters. | No | `<short commit id>` |
| `DATABASE_URL` | The Postgres connection string the app uses, usually the pooled one. Required. Without it the deployment is `unconfigured`. | Yes | `postgres://<user>:<password>@<host>/<database>` |
| `DATABASE_URL_UNPOOLED` | A direct connection for migrations, for providers that separate pooled and direct connections. Optional; falls back to `DATABASE_URL`. | Yes | `postgres://<user>:<password>@<direct-host>/<database>` |
| `BETTER_AUTH_SECRET` | Signs login cookies and the verification proof. Required, at least 32 characters. Changing it signs everyone out. | Yes | `<generate: 32 random bytes as hex>` |
| `JOBS_TICK_SECRET` | The credential of the batch endpoint `POST /api/jobs/tick`, sent as a bearer value and compared in constant time. Required, at least 32 characters. The same value goes into the repository secret `ORBITDIFF_WEB_JOBS_SECRET`. | Yes | `<generate: 32 random bytes as hex>` |
| `ADMIN_EMAILS` | Comma-separated addresses that may use `/admin` and `/api/admin/*`. The address must also be verified and active. Nothing else grants admin: no database column, no request field, no sign-up order. Optional; empty means nobody. | No, but personal data | `operator@example.com` |
| `OPERATOR_NAME` | Who runs the service, shown on the legal pages. 2 to 80 characters. Registration is closed until it is set. | No | `<name of the person or organisation>` |
| `EMAIL_TRANSPORT` | `capture` stores account mail in the database instead of sending it (tests and staging; refused when `APP_STAGE=production`). `none` sends nothing and closes registration. Default `none`. | No | `none` |
| `MAILBOX_SECRET` | The credential of `GET /api/staging/mailbox`, which returns captured mail for an address. At least 32 characters. Required when `APP_STAGE=staging` and mail is captured. The endpoint does not exist in production or without this value. | Yes | `<generate: 32 random bytes as hex>` |
| `SIGNUP_ACCESS_CODE` | When set, sign-up must carry this code in the `x-signup-code` request header. At least 12 characters. Optional. Use it to keep a preview private. | Yes | `<a phrase you hand to invited people>` |
| `CAPACITY_MAX_USERS` | Verified accounts. At the limit registration pauses with a visible reason. Accounts that wait for verification take no place; at most this many of them are kept, and a new sign-up removes the oldest to make room, so nobody can close registration with made-up addresses. Positive integer, default 250. | No | `250` |
| `CAPACITY_MAX_JOBS_PER_DAY` | Jobs started per UTC day. At the limit scheduled work pauses until the next UTC day. Positive integer, default 2000. | No | `2000` |
| `CAPACITY_MAX_DB_BYTES` | Database size at which imports pause. Set it below the limit of the database plan. Positive integer, default 419430400 (400 MB). | No | `419430400` |
| `CLIENT_IP_HEADER` | The request header that carries the client address for the per-client rate limit. The platform must set and overwrite it. Default `x-forwarded-for`, which Vercel overwrites. It can never be a header that carries a credential. | No | `x-forwarded-for` |
| `TRUSTED_PROXIES` | Comma-separated proxy addresses or CIDR ranges that may appear in that header. When set, the client is the last hop that is not one of them. Optional. | No | `203.0.113.0/24` |

Rules that tie them together:

- `EMAIL_TRANSPORT=capture` with `APP_STAGE=production` is refused when the configuration is read. A production deployment therefore has no mail, and registration there is closed.
- `APP_STAGE=staging` with captured mail needs `MAILBOX_SECRET`.
- On any host other than Vercel, set `CLIENT_IP_HEADER` to the header that host overwrites. A header a caller can send through unchanged makes the per-client limits meaningless.

## 3. How registration opens

`GET /api/health` reports `registration.open`, and `registration.reason` when it is closed. It reads the same function the sign-up gate calls, so what it reports is what the gate does. Sign-up is refused until every line below holds, checked in this order.

| Gate | Requirement | When it fails |
| --- | --- | --- |
| A database | `DATABASE_URL` is configured and reachable, and the other required variables are valid. | Health answers `unconfigured` or `degraded`; registration is closed. |
| Operator name | `OPERATOR_NAME` names who runs the service. | Closed: "the operator of this service has not been named yet". |
| Mail delivery | Account mail can reach the person. Today that means `EMAIL_TRANSPORT=capture`, which is allowed outside production only. | Closed: "email delivery is not configured". |
| Capacity | Fewer verified accounts than `CAPACITY_MAX_USERS`. An account that was never verified does not count. | Paused: "capacity reached". |
| Access code | Only when `SIGNUP_ACCESS_CODE` is set: the request carries it. | The request is refused with `ACCESS_CODE_REQUIRED`. Registration still reads as open, with `accessCodeRequired: true`. |
| Consent | The request names the current versions of the Terms and the Privacy notice. | The request is refused with `TERMS_NOT_ACCEPTED` or `PRIVACY_NOT_ACCEPTED`. |

After sign-up the address has to be verified: the person opens the link from the mail and then signs in from the same browser with their password. The link alone verifies nothing. On a staging deployment the operator reads the captured mail from the mailbox endpoint with `MAILBOX_SECRET`.

Production registration cannot open today, because production has no mail transport.

## 4. The job tick

Background work is a `job` table drained by `POST /api/jobs/tick`. One call recovers expired leases, queues the daily reviews that are due, drains a bounded batch, cleans up what is past its retention window, measures the database, and returns a summary of counts. It never contacts Instagram or any other host. It is safe to call again, and to call twice at once.

An import is also processed right after the import request, so a customer does not wait for the next hour. The hourly tick remains the durable path: whatever that run did not finish, the tick completes.

### The workflow

`.github/workflows/orbitdiff-web-jobs.yml` calls the endpoint at minute 17 of every hour. It is the scheduler; a Vercel cron is not, because on the Hobby plan it can run only once per day.

It reads two repository secrets:

| Repository secret | Value |
| --- | --- |
| `ORBITDIFF_WEB_JOBS_URL` | The full address of the endpoint: `https://<your-host>/api/jobs/tick` |
| `ORBITDIFF_WEB_JOBS_SECRET` | The same value as `JOBS_TICK_SECRET` on the deployment |

Set them from standard input, so the value is not in the shell history. `$WORK` is a private directory outside the repository (section 5 creates it):

```sh
printf '%s' 'https://<your-host>/api/jobs/tick' | gh secret set ORBITDIFF_WEB_JOBS_URL
gh secret set ORBITDIFF_WEB_JOBS_SECRET < "$WORK/tick-secret.txt"
```

While either secret is missing the workflow prints a warning, runs nothing, and succeeds.

Two rules of GitHub Actions matter here:

- **Scheduled runs start only from the default branch.** The schedule does nothing until the workflow file is on the default branch, and it always runs the version of the file that is there.
- **The 60 day rule.** In a public repository GitHub disables scheduled workflows after 60 days without repository activity. Re-enable it from the Actions tab or with `gh workflow enable orbitdiff-web-jobs.yml`. Until then no reviews run and failed work is not retried; imports are still processed right after they arrive.

Runs can be delayed or dropped when GitHub is busy. The next run catches up, because everything the tick does is keyed so that it happens once. One run drains up to 200 jobs inside its 45 second budget, more than the reviews that fall due in an hour at the registration cap. A daily review that is still waiting when its profile's next review falls due keeps the profile due, so the later day's review runs after it instead of being merged into it. Until then the pages say the review is overdue.

### Running it by hand

From GitHub, with the repository secrets:

```sh
gh workflow run orbitdiff-web-jobs.yml
gh run list --workflow orbitdiff-web-jobs.yml --limit 1
```

Or directly, with the secret in an environment variable of your shell:

```sh
curl --silent --show-error --request POST \
  --header "Authorization: Bearer ${JOBS_TICK_SECRET}" \
  "https://<your-host>/api/jobs/tick"
```

The answer holds counts and flags only:

```json
{ "at": "2026-09-30T12:17:03.000Z", "recovered": 0, "enqueued": 2, "claimed": 2, "succeeded": 2,
  "failed": 0, "retried": 0, "cancelled": 0, "remaining": 0, "cleaned": 0, "durationMs": 184,
  "pausedForCapacity": false }
```

Without the right secret the endpoint answers 404, the same as a route that does not exist. `GET /api/health` shows when the tick last ran as `lastTick.at`, and nothing else about it. `pausedForCapacity: true` means the day's job count reached `CAPACITY_MAX_JOBS_PER_DAY`; scheduled work resumes on the next UTC day. While it is paused, the dashboard, every profile page, and the settings page show a notice with that reason and the time it resumes.

## 5. Deployment, once the owner provides a database

Nothing in this section has been run. These are the steps for when a Postgres connection string exists. They use the Vercel CLI from the `web/` directory; only that directory is uploaded, so leave the project's Root Directory setting empty.

Before you start, check that the database you connect stops or rejects at its free limit instead of billing, as [`infrastructure.md`](infrastructure.md) requires.

1. **Link** the directory to the project.

   ```sh
   cd web
   vercel link --yes --team <team-slug> --project orbitdiff-web
   ```

2. **Set the variables** from standard input, one call per variable, so no value appears in the process list, the shell history, or a file in the repository. Do not use `vercel env pull`: it writes an env file.

   ```sh
   WORK="$(mktemp -d)"                       # a private directory outside the repository
   # Put the connection string the owner provided into "$WORK/database-url.txt", with no line break at the end.
   vercel env add DATABASE_URL production --sensitive < "$WORK/database-url.txt"
   openssl rand -hex 32 | tr -d '\n' | vercel env add BETTER_AUTH_SECRET production --sensitive
   openssl rand -hex 32 | tr -d '\n' > "$WORK/tick-secret.txt"
   vercel env add JOBS_TICK_SECRET production --sensitive < "$WORK/tick-secret.txt"
   printf '%s' production | vercel env add APP_STAGE production
   printf '%s' 'https://<your-host>' | vercel env add APP_BASE_URL production
   printf '%s' none | vercel env add EMAIL_TRANSPORT production
   printf '%s' '<operator name>' | vercel env add OPERATOR_NAME production
   printf '%s' '<operator address>' | vercel env add ADMIN_EMAILS production
   ```

   `vercel env add name environment` reading the value from standard input, and the `--sensitive` flag, are both in the help text of the installed CLI (59.11.2). The two together have not been run here. If the CLI asks a question, answer it; the value still comes from standard input.

   Add `DATABASE_URL_UNPOOLED` the same way only when the provider has a separate direct connection. The capacity values and `CLIENT_IP_HEADER` have working defaults on Vercel. Set `CAPACITY_MAX_DB_BYTES` below the limit of the database plan.

   For a private preview that captures mail, use `APP_STAGE=staging` and `EMAIL_TRANSPORT=capture`, and add `MAILBOX_SECRET` and `SIGNUP_ACCESS_CODE` the same way.

   When section 4 is done as well, remove the two files and the directory: `rm "$WORK/database-url.txt" "$WORK/tick-secret.txt" && rmdir "$WORK"`.

3. **Check, then deploy.** `vercel-build` runs the hosted rules check first, then the migrations, then the build, so a build fails if hosted code ever reaches for Instagram. Nothing runs the tests before a deploy: CI has no job for `web/`. Run the tests and `corepack yarn rules:check` from `web/` first, and deploy only when both exit with status 0. The tests start their own throwaway Postgres and need none of the variables above.

   ```sh
   corepack yarn test
   node scripts/check-hosted-rules.mjs
   ```

   `package.json` defines a `vercel-build` script, which runs the hosted rules check, applies pending migrations with `scripts/migrate.ts`, and then builds. Vercel is expected to run that script in place of `build` when a package defines it. This has not been observed for this project, so confirm it in the first build log: the line `migrations: applied` has to appear before the Next.js build output. If it does not, set the project's build command to `yarn vercel-build`. A failed migration fails the build, so nothing is released on a schema it does not match.

   ```sh
   vercel deploy --prod --yes
   ```

4. **Verify health.** The answer has to show a reachable database and the stage you set.

   ```sh
   curl --silent "https://<your-host>/api/health"
   ```

   Expect status 200 and `"status": "ok"`, `"database": { "ok": true }`, `"stage"` as configured, and `registration` as section 3 predicts: closed with a reason in production, open on a staging deployment with captured mail and a named operator. A 503 with `"status": "unconfigured"` lists the variables that are missing or not valid.

5. **Schedule the tick.** Set the two repository secrets from section 4 (the content of `"$WORK/tick-secret.txt"` is the second one), make sure the workflow file is on the default branch, run it once by hand, and confirm that `lastTick.at` in the health answer moved.

6. **Walk the journey** on a staging deployment: sign up, read the captured mail, verify, onboard, add a profile, import two exports, and check the results, as `web/tests/integration/journey/customer.test.ts` does against the test database.

## 6. Rollback

Promote the previous deployment.

```sh
vercel list                                # find the deployment that was live before
vercel promote <deployment-url-or-id>
curl --silent "https://<your-host>/api/health"   # "commit" shows what is live when APP_COMMIT_SHA is set
```

The installed CLI also has `vercel rollback <deployment-url-or-id>`, which its help text describes as reverting to a previous deployment. Neither command has been run here.

The database is not rolled back, and does not need to be: migrations are additive. A migration adds tables, columns, or indexes and never drops or rewrites what an earlier release reads, so the previous code keeps working against the newer schema. Migrations live in `web/drizzle/`, are generated with `corepack yarn db:generate`, and are never edited by hand. A change that cannot be made additively needs two releases: first the release that stops using the old shape, then the one that removes it.

Environment variables work differently: a deployment keeps the values it was built with. Vercel applies a change made with `vercel env add`, `vercel env update`, or `vercel env rm` only to deployments made after it, and promoting or rolling back to an older deployment serves that deployment with its own values, not the current ones. If a bad value caused the problem, correct it with `vercel env update` and deploy again.

To stop the scheduled runs, remove or change the `ORBITDIFF_WEB_JOBS_SECRET` repository secret, or disable the workflow with `gh workflow disable orbitdiff-web-jobs.yml`; this takes effect from the next run. Imports are still processed right after they arrive, because that run belongs to the deployment.

To stop sign-ups, remove `OPERATOR_NAME` and deploy again: `vercel env rm OPERATOR_NAME production`, then `vercel deploy --prod --yes`. Registration closes when the new deployment is live, and existing accounts keep working. Removing the variable alone changes nothing on the deployment that is running.
