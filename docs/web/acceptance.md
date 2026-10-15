# OrbitDiff Web acceptance record

Recorded 2026-09-30 on branch `web/orbitdiff-web`. Every result below comes from a command, a test file, or a browser check that was run. A short test run is not a 24-hour production cycle, and nothing here is deployed.

## Where things stand

- **Not deployed.** An empty Vercel Hobby project exists for the app. Production Postgres is blocked: the owner ruled out Vercel Marketplace databases, and the only free create path found requires accepting marketplace terms. Production mail is unimplemented, and registration stays closed until an operator is named.
- **The local product is unchanged.** The OrbitDiff Agent Skill, the CLI, and the Orbit OS desktop app are untouched and still install from the v0.2.x releases. The branch changes only `web/`, `docs/web/`, and `.github/workflows/orbitdiff-web-jobs.yml`.
- **Hosted automatic identity tracking is Unsupported.** Owner exports are the identity path. See `capability-matrix.md`.

## Verification commands

Run from `web/` with `COREPACK_HOME` set outside the home directory, unless noted.

| Check | Command | Result |
| --- | --- | --- |
| Web tests against a throwaway local Postgres, no hosted database | `corepack yarn test` | 126 files, 3,783 tests passed, exit status 0 |
| Types | `corepack yarn typecheck` | exit status 0 |
| Lint | `corepack yarn lint` | exit status 0 |
| Hosted rules gate (no Instaloader, no Instagram requests, no credential fields, no overclaiming copy) | `corepack yarn rules:check` | 225 files checked, no findings |
| TypeScript port equals the Python rules | `corepack yarn parity:check` | golden file current |
| Production build | `corepack yarn build` | exit status 0, every page rendered per request |
| Public-safety scan and ruff over the files git would commit | scanner from `scripts/` on an export of the commit set | clean, 514 files; ruff all checks passed |
| Existing Python suite, from the repository root | `pytest`, `ruff check .`, `mypy src` | 327 passed; all checks passed; no issues in 21 source files |

## Browser journey

Production build (`next build`, `next start`) with a throwaway local Postgres, captured mail, and three synthetic accounts, driven by hand in a real browser at a phone width and a desktop width.

| Step | Observed |
| --- | --- |
| Sign-up without ticking the Terms box | Refused in the form with a named error; no account created |
| Sign-up with consent | Account created; verification mail captured; the captured mailbox answers 401 without its secret |
| Open the verification link | Nothing signed in; the page asks for a sign-in in the same browser |
| Sign in | Address confirmed; sent to onboarding |
| Onboarding, profile entered as a mixed-case profile URL with a query | Stored as `atlas_studio`; the dashboard shows that automatic identity tracking is unavailable |
| First import, parsed in the browser | Recognized files and shard numbers listed; capture time sent with an explicit offset; receipt "Baseline stored"; processing finished right after the import; counts 2 and 2, mutuals 1; Changes tab: "Baseline stored. Import a later export to see differences." |
| Second import with one follower added and one removed | Exactly two rows, each labelled Export observation and dated as an interval between the two capture times; counts read "No net change" |
| Batch endpoint | 404 without or with a wrong secret; counts-only summary with the right secret; a second call did no duplicate work |
| Second account opens the first account's profile URL | Page not found; the API returns the same 404 body as for a random id; `/admin` and `/api/admin/users` answer 404 |
| Configured admin opens `/admin` | Capacity against the caps and every account with consent versions and usage; no passwords, tokens, rosters, or Instagram usernames |
| Settings at desktop width | No horizontal overflow |

## Requirement by requirement

**Pass** means proven by the commands, tests, and browser checks above. **Unproven** means built and tested locally but not observed on a deployment. **Fail** means not delivered. **Unsupported** means no authorized source exists.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Sign-up, sign-in, sign-out, recovery, persistent sessions, email verification | Pass locally; Unproven deployed | `tests/integration/auth/*`, the browser journey; production mail is unimplemented, so production registration is closed |
| OrbitDiff account separate from Instagram; email, display name, timezone, consent; what is collected and why; marketing consent separate | Pass | sign-up page and privacy notice; `tests/integration/auth/consent-*.test.ts`, `marketing-consent.test.ts` |
| Admin from server configuration only; never a client field or the first account | Pass | `tests/integration/api/admin.test.ts`, `screens-admin-visitors.test.ts`, `tests/integration/journey/*`, browser journey |
| Add, view, pause, resume, remove profiles; validate handles and profile URLs | Pass | `tests/integration/services/profiles.test.ts`, `tests/unit/domain/handles.test.ts`, browser journey |
| Supported capabilities shown before anything is connected | Pass | landing page and the capability notice on onboarding, dashboard, and profile pages |
| Owner export import, manual | Pass | browser journey; `tests/integration/api/imports.test.ts`; parity tests for the parser |
| Provider-supported authorization for automatic tracking | Unsupported | No authorized source lists follower or following identities. Official aggregate counts would need a Meta app and App Review; not implemented. See `capability-matrix.md` |
| Dashboard: counts, count history, export-observed changes, last successful and next scheduled review, source and coverage, errors, paused, stale, processing, failed, search and filters, phone and desktop | Pass locally | `tests/unit/workspace/*`, `tests/integration/journey/*`, browser journey |
| Pending versus confirmed changes | Not applicable to hosted evidence | No hosted source feeds the public following-list state machine; it is ported and pinned by `src/orbitdiff/fixtures` in `tests/parity` |
| Scheduled server-side work with the browser closed; user timezone, UTC storage, bounded retries, no duplicates, recovery after restarts, manual refresh under the same limits | Pass locally; Unproven deployed | `tests/integration/jobs/*` (leases, takeover, duplicate delivery, daylight saving transitions, capacity); the workflow file exists but schedules start only from the default branch and nothing is deployed for it to call |
| Opt-in email summaries | Not built | No configured delivery service; allowed by the brief |
| Account data export and deletion; deletion stops jobs | Pass | `tests/integration/journey/*`, `tests/integration/auth/deletion.test.ts` |
| Tenant isolation, including worker paths and self-granted admin | Pass | `tests/integration/tenancy/isolation.test.ts`, `tests/integration/journey/two-users.test.ts`, browser journey |
| Evidence rules: silent baseline, export observations with intervals, user-declared completeness, no invented removals, failures keep the last success, count changes never name accounts | Pass | parity tests against the Python rules, `tests/integration/journey/evidence.test.ts`, journey tests, browser journey |
| Quotas, capacity pauses, stop before overage | Pass locally | `tests/integration/services/usage.test.ts`, `tests/integration/jobs/*`; `infrastructure.md` |
| No LLM, scraper, Instaloader, session files, Instagram credentials, or Instagram requests | Pass | `corepack yarn rules:check`; the tick test asserts no outbound request |
| Existing skill, CLI, and desktop checks still pass | Pass | Python suite above; nothing outside the three paths changed |
| Deployed URL, deployed scheduler run, deployed smoke checks | Fail (blocked) | Not deployed: no database without accepting marketplace terms, and the owner said not to deploy yet |

## What only a person can do

1. Choose a Postgres database whose create path shows no terms, card, or charge, or accept a marketplace's terms yourself, and provide its connection string as `DATABASE_URL`.
2. Name the operator (`OPERATOR_NAME`) and have the privacy notice and terms reviewed.
3. For public registration: a sending domain you control and a mail provider key. Production mail delivery must then be built.
4. Merge the branch so the hourly schedule can start, then set the two repository secrets named in `operations.md` once a deployment exists.
5. Optionally, for official aggregate counts: a Meta app, Business Verification, and App Review.
