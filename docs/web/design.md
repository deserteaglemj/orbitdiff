# OrbitDiff Web: design

This is the contract for the hosted app in `web/`. Where code and this page disagree, fix the code or raise the disagreement.

OrbitDiff Web sits beside the local product. The Python package, the OrbitDiff Agent Skill, the CLI, and the Orbit OS desktop app are unchanged. Read `CONTEXT.md` for the vocabulary used here and `docs/web/capability-matrix.md` for what may be claimed.

## 1. Product truths

1. An OrbitDiff account is separate from any Instagram account.
2. The hosted app has one evidence lane: **owner export observations**. Identities are usernames. Capture time is an explicit ISO timestamp with a timezone. A completeness flag is a user assertion. Effective complete coverage also needs contiguous shards and a known capture time.
3. The first import for a profile is a baseline and produces no change entries. Differences between two dated imports are export observations, never live follows or unfollows.
4. A count change is a count change: "net growth of 3", never three named accounts.
5. Hosted automatic identity collection is unsupported and the interface says so. The hosted app never runs Instaloader, never loads a session file, and never asks for a password, code, cookie, or session.
6. The public following-list state machine (`src/orbitdiff/diff.py`) is ported and pinned by `src/orbitdiff/fixtures`. No hosted source feeds it and no route exposes it.
7. Background jobs process stored imports and daily reviews. They never contact Instagram. A failed job is shown as a failure next to the last success and never replaces it.
8. Nothing personal is copied from a local workspace. Tests use `atlas_studio`, `nova_labs`, `pixel_forge` and other synthetic handles.

## 2. Architecture

- Next.js 16 App Router in `web/`, TypeScript strict, React server components for reads, JSON route handlers under `/api` for every mutation.
- Postgres through Drizzle ORM and the `pg` driver in every environment.
- Better Auth: email and password, email verification required, password reset, database sessions in secure httpOnly cookies, database-backed rate limiting. No OAuth, no admin plugin, no email change.
- Durable jobs: a `job` table drained by `POST /api/jobs/tick`. The tick is called hourly by the GitHub Actions workflow `.github/workflows/orbitdiff-web-jobs.yml` and opportunistically right after an import. A Vercel cron is not the scheduler.
- Exports are parsed in the browser. Only recognized follower and following usernames, shard numbers, the capture time, and the completeness declarations are sent. The server stores no uploaded files.
- No LLM, scraper, or paid dependency.

### Layout

```
web/
  drizzle/                       generated SQL migrations (linear, never edited by hand)
  scripts/                       migrate.ts, auth-cli-config.ts, parity helpers
  src/app/                       pages and /api route handlers
  src/components/                shared UI
  src/domain/                    pure, isomorphic logic with no I/O
    limits.ts                    every quota and bound
    handles.ts                   handle and profile URL rules
    canonical.ts                 canonical JSON and SHA-256 digests equal to the Python ones
    capture-time.ts              capture time parsing and canonical form
    export/files.ts              member path safety, recognized names, shard and root rules
    export/rows.ts               relationship row extraction
    export/zip.ts                bounded ZIP reading
    export/snapshot.ts           identities, coverage, store decision, view, export events
    following/reconcile.ts       port of diff.py plus collection validation (fixture-tested only)
    schedule.ts                  timezone-aware next review time
    counts.ts                    count history and net change wording
  src/server/
    env.ts                       validated configuration
    db/                          schema.ts, auth-schema.ts (generated), client.ts
    http/                        errors.ts, handler helpers, origin check
    auth/                        options.ts, auth.ts, guards.ts
    mail/                        transport.ts (capture, none)
    services/                    tenant-scoped data access; userId is always the first argument
    jobs/                        queue.ts, tick.ts, handlers.ts
  tests/unit, tests/parity, tests/integration, tests/e2e, tests/setup
```

### Repository guard rails for `web/` and `docs/web/`

The existing CI runs `scripts/public_safety_scan.py` over the whole checkout. Every committed file must pass it unchanged:

- no U+2014 character;
- no absolute path into a home directory (the macOS or Linux home prefix followed by a name);
- no file named `.env*`, no file name containing `session.`, `session-`, or `session_`, no `.db` or `.sqlite` file;
- no token of 40 or more characters from `[A-Za-z0-9_+=-]` with high entropy. Keep identifiers, test names, and fixture strings short. Hex digests are fine;
- Yarn 4 is the package manager because its lockfile uses hex checksums. Do not add an npm or pnpm lockfile;
- any Python file under `web/` must pass `ruff check .`;
- no `SKILL.md` and no `skills/<name>/` directory under `web/`.

Local tool notes: set `COREPACK_HOME` to a directory outside the home directory before running `corepack yarn ...`. Dependency install scripts are disabled (`enableScripts: false`); only the embedded Postgres test binary is allowed to run its symlink script.

## 3. Data model

`web/src/server/db/schema.ts` is authoritative. Every application row carries `user_id` and cascades when the user is deleted.

| Table | Purpose |
| --- | --- |
| `user`, `session`, `account`, `verification`, `rate_limit` | Better Auth. `user` adds `timezone`, `review_hour`, `status`, `onboarded_at`, `accepted_terms_version`, `marketing_opt_in`. There is no role or admin column. |
| `consent_record` | Append-only consent log (`terms`, `privacy`, `marketing`), with version, granted flag, source, and time. |
| `profile` | An owner account handle the user imports exports for. `status` is `active` or `paused`. `content_revision` rises when export history changes; `derived_revision` is the revision the derived data reflects. |
| `export_snapshot` | One export observation: rosters as username arrays (null means direction not supplied), shards, declarations, effective coverage, digests, capture and import time, `is_current`. |
| `change_event` | Export observations between consecutive dated snapshots. A derived view, replaced as a whole. |
| `job` | Durable work: `derive_profile`, `daily_review`, `manual_review`. |
| `activity_entry` | The user-visible feed: imports received and processed, reviews, failures, profile changes. |
| `usage_daily` | Per-day counters for quotas. |
| `system_state` | Last tick, measured database size, capacity flags. |
| `audit_event` | Security-relevant events without personal data. |
| `mail_capture` | Mail captured instead of delivered (tests and staging only). |

## 4. Domain rules

### 4.1 Handles and profile URLs

`normalizeHandle(value)`: matches `(?!\.+$)[A-Za-z0-9._]{1,30}` in full, then lowercases. No trimming. Equal to `personal._handle`.

`parseProfileInput(value)`: for the add-profile form. Trims surrounding ASCII whitespace, removes one leading `@`, then either accepts a handle, or accepts a URL with scheme `http` or `https`, host `instagram.com` or `www.instagram.com`, no port and no user info, and exactly one path segment (an optional trailing slash is allowed); the query and fragment are discarded. Post, reel, story, and unrelated URLs are rejected with a specific message. The result goes through `normalizeHandle`.

### 4.2 Owner export parsing, a port of `src/orbit_os/personal.py`

The port must reproduce the Python behaviour exactly. The golden file generated from the Python implementation is the referee.

- Recognized names: `followers.json`, `following.json`, `followers_N.json`, `following_N.json` with N from 1 to 9999 and no leading zero, case-sensitive. Accepted at the root of the supplied set or directly inside a directory named `followers_and_following`. Anything else is ignored.
- Shard number is the suffix, or 0 without one. Shard 0 cannot mix with numbered shards and a shard cannot repeat. All recognized files must share one parent path.
- Member paths: at most 1,024 characters, no leading slash, no backslash, no colon, no empty, `.` or `..` segment, no control characters, at most 16 segments of at most 255 characters, no `.ssh`, `.env`, or `.env.*` segment.
- JSON: duplicate keys are rejected. A document is a list, or an object whose `relationships_followers` or `relationships_following` key holds the list. Owner metadata under `account`, `username`, or `owner` must equal the selected account when present.
- Rows: an object whose `string_list_data` is a list with exactly one object. The handle is `value` when truthy, else `title`. A truthy `title` must equal the handle. An `href`, when present, is a string of at most 200 characters with scheme `http` or `https`, host `instagram.com` or `www.instagram.com` compared case-insensitively, empty query, empty fragment, and a path that yields the same handle after removing a trailing slash run and one leading `/_u/`. Row timestamps are never read.
- Result per direction: sorted, unique, lowercased handles. A missing direction is `null`, not an empty list.
- ZIP input: one ZIP only. Central directory bounded before reading, at most 1,024 entries, no ZIP64, no multi-disk, duplicate names rejected, no links or special files, recognized members must be stored or deflate and unencrypted, declared size must equal actual size. Only recognized members are decompressed.
- Known Python and JavaScript differences must be handled deliberately: duplicate-key detection needs a custom scan; `NaN` and `Infinity` literals and a byte order mark are accepted by Python; the URL must be split by hand to mirror `urlsplit`, not with `new URL()`; sorting is by code point, never `localeCompare`.

Hosted bounds (lower than local): 16 MiB per recognized file and 32 MiB total in the browser, 1,024 files, and `LIMITS.accountsPerSnapshot` usernames across both directions.

### 4.3 Capture time

Optional. When present it is a string of at most 40 characters that carries a timezone, and it is not more than five minutes in the future. Canonical form is UTC with seconds precision, `YYYY-MM-DDTHH:MM:SS+00:00`. The clock is injected. It is never taken from a file date, a relationship timestamp, or the import time.

### 4.4 Snapshot identity and store decision

- `canonical(value)` equals Python `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)`.
- `contentDigest = sha256(canonical([account, followers, following, {followers: shards, following: shards}]))`.
- `snapshotDigest = sha256(canonical([contentDigest, capturedAt]))` with `capturedAt` the canonical string or `null`.
- Same `snapshotDigest` already stored: duplicate. No new snapshot; declarations are OR-merged.
- Dated import whose content equals a stored undated snapshot: that snapshot is replaced in place (enriched).
- Dated import at a stored capture time with different content: rejected as a conflict.
- Otherwise appended, unless the profile already holds `LIMITS.snapshotsPerProfile` snapshots.
- The import becomes current only when there is no current snapshot, or it is dated and the current one is undated or earlier.

### 4.5 Coverage, view, and export events

- Coverage of a direction is complete only when it is present, its shards are contiguous (`[0]` or `1..N`), the capture time is known, and the user declared it complete. It is always labelled user-declared.
- View of the current snapshot: for each username, `following` and `followedBy` are `true` when present, `false` only when that direction's coverage is complete, otherwise `null`. Relationship is `mutual`, `not_following_back`, `follows_you`, or `unknown`. Metrics follow `personal._view`: counts are `null` unless coverage supports them.
- Status: `degraded` when any direction is not complete, else `stale` when the capture time is older than 36 hours, else `ok`.
- Events: take dated snapshots in ascending capture order and compare consecutive pairs, newest pair first. Additions are reported only when the earlier snapshot's direction is complete, removals only when the later one's is. Event types are `follower_observed_added`, `follower_observed_removed`, `following_observed_added`, `following_observed_removed`. The digest is `sha256(canonical([previous.snapshotDigest, current.snapshotDigest, type, username]))`. Undated snapshots never participate. Events are a pure function of the whole dated history.

### 4.6 Public following-list state machine (fixture-tested only)

`reconcile(edge, observedPresent)` returns `none`, `pending`, `confirm`, or `clear` exactly as `diff.py` does. `validateCollection` applies the completeness rules of `providers/base.py`. `applyCollection(state, collection)` reproduces `GraphStore.apply_collection` over an in-memory state. The tests replay `src/orbitdiff/fixtures/baseline.json`, `pending.json`, and `confirmed.json` and expect a silent baseline, two pending edges, then `following_stopped nova_labs` and `following_started ember_lab`.

### 4.7 Counts

Count history is the series of dated snapshots whose direction coverage is complete. `describeNetChange(previous, next)` returns "Net growth of N", "Net decline of N", or "No net change". No function in the app turns a count difference into usernames.

### 4.8 Review schedule

Each user has an IANA timezone and a local review hour (0 to 23). `nextReviewAt(now, timezone, hour)` is the first instant strictly after `now` whose local time is `hour:00`. A local time that does not exist (spring forward) resolves to the first valid instant after the gap; a local time that occurs twice (fall back) resolves to the first occurrence. The daily job key is `daily:<profileId>:<localDate>`, so a profile gets at most one scheduled review per local date on 23, 24, and 25 hour days and across timezone changes.

## 5. Jobs

| Kind | Trigger | Work |
| --- | --- | --- |
| `derive_profile` | Every import that changes history | Re-derive export events and the profile summary from the whole dated history, replace them atomically, set `derived_revision`, write an `import_processed` activity entry. |
| `daily_review` | The tick, when `next_review_at` is due | Record freshness (no import, stale, or current), coverage, and counts as a `review` activity entry; advance `next_review_at`. |
| `manual_review` | `POST /api/profiles/:id/review` | Same work as a daily review, under the cooldown and the daily limit. |

Queue rules:

- Enqueue inserts with a unique `dedupe_key` (`derive:<profileId>:<contentRevision>`, `daily:<profileId>:<localDate>`, `manual:<profileId>:<requestId>`). One queued or running job per profile and kind is enforced by a partial unique index.
- Claim: `for update skip locked` on queued jobs whose `run_after` has passed, then `running` with a fresh `lock_token`, a lease, and `attempts + 1`.
- Authorize at execution time inside the worker: the user must exist, be verified, and be `active`; the profile must exist and, for reviews, be `active`. Otherwise the job is `cancelled` with a reason.
- Complete: one transaction writes results and marks the job, guarded by `status = 'running' and lock_token = ?`. If the guard fails nothing is written. `activity_entry` is unique on `(job_id, kind)`, so duplicate delivery cannot apply twice.
- Failure: retry with backoff (5 minutes, then 30 minutes) up to three attempts, then `failed` with a `job_failed` activity entry and `profile.last_failure_*`. `last_success_at` is never changed by a failure.
- Recovery: the tick requeues running jobs whose lease expired, or fails them at the attempt limit.
- Cancel: pausing a profile cancels its queued review jobs in the same transaction. Removing a profile or deleting an account removes its jobs through the cascade; a running job then fails its completion guard.

Tick (`POST /api/jobs/tick`, header `Authorization: Bearer <JOBS_TICK_SECRET>`, constant-time compare): recover expired leases, enqueue due daily reviews for active profiles of verified active users, drain up to `LIMITS.tickMaxJobs` jobs with `LIMITS.tickConcurrency` workers inside `LIMITS.tickBudgetMs`, run bounded retention cleanup, measure database size, store `system_state.last_tick`, and return a summary. Safe to call concurrently and repeatedly.

## 6. Quotas

All values live in `web/src/domain/limits.ts`. When a limit is reached the action returns `quota_exhausted`, `cooldown`, or `capacity_paused`, the interface shows a visible paused state with the reason, and nothing falls through to a paid tier. Global capacity (`CAPACITY_MAX_USERS`, `CAPACITY_MAX_JOBS_PER_DAY`, `CAPACITY_MAX_DB_BYTES`) pauses registration, scheduled work, and imports respectively.

## 7. Authorization

- `requireUser()`: valid session, verified email, `status = 'active'`. `requireOnboardedUser()` additionally requires recorded terms and privacy consent and `onboarded_at`.
- Every service function takes `userId` first and filters by it. A missing id and another tenant's id both return `not_found` (HTTP 404).
- Admin: `requireAdmin()` passes only when the session user's verified, lowercased email is in `ADMIN_EMAILS`. No database column, request field, or signup order grants admin. Everyone else gets 404 on `/admin` and `/api/admin/*`.
- State-changing routes require a same-origin `Origin` header.
- Request bodies are parsed with strict schemas; unknown keys are rejected.
- Logs never contain tokens, cookies, passwords, or full email addresses.

## 8. HTTP API

Errors are `{ "error": { "code", "message", "details"? } }`. Codes and statuses: `unauthenticated` 401, `unverified` 403, `suspended` 403, `forbidden_origin` 403, `not_found` 404, `conflict` 409, `invalid_input` 422, `quota_exhausted` 429, `cooldown` 429, `capacity_paused` 503, `unavailable` 503, `internal` 500. Lists return `{ "data": [...], "pagination": { "page", "pageSize", "totalItems", "totalPages" } }`.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Public. Stage, commit, database reachability, mail delivery mode, registration state, last tick. No secrets. |
| `/api/auth/*` | Better Auth. Sign-up is gated by capacity, the optional access code, and consent. |
| `GET, PATCH /api/me` | Profile of the signed-in user; PATCH accepts `name`, `timezone`, `reviewHour`. |
| `POST /api/me/consent` | Record a marketing consent change. |
| `POST /api/me/onboarding` | Record terms and privacy consent and mark onboarding complete. |
| `GET, POST /api/profiles` | List and add profiles. |
| `GET, PATCH, DELETE /api/profiles/:id` | Read, pause or resume (`{ "status": "paused" }`), remove. |
| `POST /api/profiles/:id/imports` | Import a normalized export. Returns the receipt and the queued job. |
| `GET /api/profiles/:id/snapshots` | Import history. |
| `GET /api/profiles/:id/relationships` | Current snapshot accounts with `q`, `relationship`, `page`, `pageSize`. |
| `GET /api/profiles/:id/events` | Export observations with `type`, `q`, `page`, `pageSize`. |
| `GET /api/profiles/:id/counts` | Count history. |
| `POST /api/profiles/:id/review` | Queue a manual review. |
| `GET /api/activity` | Activity feed with `profileId`, `kind`, `status`, `q`, `page`, `pageSize`. |
| `GET /api/account/export` | Download everything stored for the user as JSON. |
| `POST /api/account/delete` | Delete the account and all its data (password required). |
| `GET /api/admin/users`, `GET /api/admin/capacity` | Admin only. |
| `POST /api/jobs/tick` | Protected batch endpoint. |
| `GET /api/staging/mailbox` | Captured mail for an address. Only when mail is captured; needs `MAILBOX_SECRET`. |

Import request body:

```
{ "account": "atlas_studio",
  "capturedAt": "2026-09-01T12:00:00+00:00" | null,
  "completeFollowers": true, "completeFollowing": true,
  "followers": ["nova_labs"] | null, "following": ["nova_labs", "pixel_forge"] | null,
  "shards": { "followers": [1], "following": [0] } }
```

The server re-validates every invariant (handle rule, sorted unique lists, shard lists sorted, unique, 0 to 9999, 0 never mixed, shards present exactly when the direction is present, at least one direction, account equals the profile handle, size bound) and computes the digests itself.

## 9. Screens

Landing, sign up, sign in, verify email, forgot and reset password, onboarding, dashboard, profile detail and history, settings, admin, privacy, terms. Every visible control works. Each data view has loading, empty, stale, failed, paused, and processing states. The dashboard and profile pages carry the notice that automatic identity tracking is unavailable. Layout works from 360 px wide to desktop and meets WCAG AA for contrast, labels, focus order, and live regions.

## 10. Configuration

`APP_STAGE` (`development`, `test`, `staging`, `production`), `APP_BASE_URL`, `APP_COMMIT_SHA`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `JOBS_TICK_SECRET`, `ADMIN_EMAILS`, `EMAIL_TRANSPORT` (`capture`, `none`), `MAILBOX_SECRET`, `SIGNUP_ACCESS_CODE`, `CAPACITY_MAX_USERS`, `CAPACITY_MAX_JOBS_PER_DAY`, `CAPACITY_MAX_DB_BYTES`.

- Configuration is validated lazily so `next build` needs no runtime secrets.
- `EMAIL_TRANSPORT=capture` is refused when `APP_STAGE=production`. With `EMAIL_TRANSPORT=none` registration is closed and the interface says why.
- Sending real mail is not implemented. It needs a domain the operator controls.
