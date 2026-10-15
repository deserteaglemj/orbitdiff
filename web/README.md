# OrbitDiff Web

The hosted app that sits beside the local OrbitDiff products. A person creates an OrbitDiff account, adds the Instagram account they own, imports their own follower and following export, and reads what the export shows: mutuals, who does not follow back, and what differs between two dated exports.

It lives in this directory only. The Python package, the OrbitDiff Agent Skill, the CLI, and the Orbit OS desktop app are separate and unchanged.

## What it is, and what it is not

[`docs/web/capability-matrix.md`](../docs/web/capability-matrix.md) is the source of truth for what may be claimed. In short:

| It is | It is not |
| --- | --- |
| A place to import your own export and read it. The export is parsed in the browser; only usernames, shard numbers, the capture time you declare, and your completeness declarations are sent. | A tracker. It never contacts Instagram, never runs a collector, never loads a saved login, and never asks for an Instagram password, code, cookie, or login of any kind. |
| A record of export observations. The first import is a baseline. Differences between two dated imports are labelled as observations of those two files over the interval between their capture times. | A feed of live follows or unfollows. A rename cannot be told apart from a new person, and the interface says so. |
| Counts where coverage is complete, with a change worded as net growth or net decline. | A way to turn a count into names. No function does that. |
| Background jobs that process stored imports and review stored evidence once a day. | Automatic identity collection. That is unsupported, and the dashboard and profile pages say so. |

The contract for the code is [`docs/web/design.md`](../docs/web/design.md). Screens and wording are in [`docs/web/interface.md`](../docs/web/interface.md), limits and cost in [`docs/web/infrastructure.md`](../docs/web/infrastructure.md), and configuration, the job schedule, and deployment in [`docs/web/operations.md`](../docs/web/operations.md).

Nothing in this directory is described as deployed. The operations page says what is missing.

## Requirements

- Node.js 22.12 or newer.
- Corepack, which ships with Node.js. The package manager is Yarn 4, pinned in `package.json`.
- Nothing else. No hosted database, no account with any provider, and no container runtime.

### COREPACK_HOME

Set `COREPACK_HOME` to a directory outside your home directory before every `corepack yarn` command. It is where Corepack keeps the Yarn release it downloads, and the design requires that it stays out of the home directory.

```sh
export COREPACK_HOME=/private/tmp/orbitdiff-corepack   # macOS; on Linux use /tmp/orbitdiff-corepack
cd web
corepack yarn install --immutable
```

Dependency install scripts are disabled in `.yarnrc.yml`. The only package allowed to run one is the embedded Postgres binary for your platform.

## Local setup with no hosted database

### Tests: the embedded test database

The integration tests start a real, throwaway Postgres 18 for the run, apply the migrations in `drizzle/`, and stop it afterwards. There is nothing to install or configure, and each run has its own database, so two runs can happen side by side.

To use a Postgres you already have instead, set `TEST_DATABASE_URL` to its connection URL. Every table in its public schema is emptied between tests, so point it only at a database you can lose.

### A development session: the dev database helper

`tests/helpers/dev-postgres.ts` starts the same embedded Postgres for a development session and removes its data when it stops.

```sh
# Terminal 1: a throwaway database on port 5439. It runs until you press Ctrl+C.
corepack yarn tsx tests/helpers/dev-postgres.ts 5439

# Terminal 2: apply the schema, then start the app.
export APP_STAGE=development
export APP_BASE_URL=http://localhost:3000
export DATABASE_URL=postgres://orbit:orbit@127.0.0.1:5439/orbitdiff_dev
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export JOBS_TICK_SECRET="$(openssl rand -hex 32)"
export MAILBOX_SECRET="$(openssl rand -hex 32)"
export EMAIL_TRANSPORT=capture
export OPERATOR_NAME="Local developer"
corepack yarn db:migrate
corepack yarn dev
```

The user and password of the helper database are fixed and not secret: it listens on `127.0.0.1` only and holds no real data. The three secrets are generated in your shell and never written to a file. Do not add a `.env` file to the repository; the repository scan rejects one.

With `EMAIL_TRANSPORT=capture` no mail is sent. Read the verification or reset message for an address from the mailbox endpoint:

```sh
curl -s -H "Authorization: Bearer $MAILBOX_SECRET" \
  "http://localhost:3000/api/staging/mailbox?to=atlas@orbitdiff.test"
```

Imports are processed right after the import request. Daily reviews, retries, and cleanup happen in the batch run, which nothing schedules locally. Run it by hand:

```sh
curl -s -X POST -H "Authorization: Bearer $JOBS_TICK_SECRET" http://localhost:3000/api/jobs/tick
```

Every variable is described in [`docs/web/operations.md`](../docs/web/operations.md).

## Commands

Run them from `web/` with `COREPACK_HOME` set.

| Command | What it does |
| --- | --- |
| `corepack yarn test` | Unit, parity, and integration tests. Exits with a non-zero status when a test fails. |
| `corepack yarn test:unit` | Unit and parity tests only. No database. |
| `corepack yarn test:integration` | Integration tests against the embedded test database, one file at a time. |
| `corepack yarn typecheck` | `tsc --noEmit` over the app, the scripts, and the tests. |
| `corepack yarn lint` | ESLint with the Next.js rules. |
| `corepack yarn parity:check` | Regenerates `tests/parity/golden.json` from the Python implementation and compares it with the committed file. Needs CPython 3.13 and `uv`; set `PARITY_PYTHON` when the interpreter is not at the default path. |
| `corepack yarn db:generate` | Generates a new SQL migration in `drizzle/` from `src/server/db/schema.ts`. Migrations are generated, never edited by hand. |
| `corepack yarn db:migrate` | Applies pending migrations to `DATABASE_URL_UNPOOLED`, or to `DATABASE_URL` when that is not set. |
| `node scripts/check-hosted-rules.mjs` | The hosted rules check over `src/`, `public/`, the configuration, and `package.json`, described below. It also runs inside `test:unit`. |
| `corepack yarn dev` | The development server. It needs the variables shown above. |
| `corepack yarn build` | A production build. It needs no runtime secrets. |

One test file:

```sh
corepack yarn vitest run --project unit tests/unit/rules/hosted-rules.test.ts
corepack yarn vitest run --project integration tests/integration/journey/customer.test.ts
```

### Where the tests are

| Directory | What it holds |
| --- | --- |
| `tests/unit` | Pure rules, components rendered to markup, and static checks over the source. |
| `tests/parity` | The export rules compared with vectors generated from the Python implementation. |
| `tests/integration` | Services, routes, authentication, and jobs against a real Postgres. |
| `tests/integration/journey` | Whole customer journeys through the public HTTP surfaces only: sign up, verify, onboard, import, read, review, export, delete, and the batch endpoint. |

There is no browser test suite. Screens are checked by hand in a real browser.

## The hosted rules check

`scripts/check-hosted-rules.mjs` reads the parts of this directory that run on the platform or decide what runs there: every file under `src/` and `public/`, `next.config.*` and `vercel.json` when they exist, and `package.json`. It prints `file:line: [rule] reason` for each finding and exits with status 1 when there is one.

| Rule | What it refuses |
| --- | --- |
| `collector` | Any mention of `instaloader`, the local collector, or of another Instagram client library, also when the name is joined from pieces such as `"insta" + "loader"`. |
| `import` | An import of anything but a file under `src/`, a package listed in `PACKAGES`, or a Node module listed in `BUILTINS`, and a dynamic `import()` or `require()` whose argument is not one quoted string. |
| `process` | Starting another program (`child_process`, `spawn`, `exec`, `fork`), or a package script that runs the local command line tools. |
| `session-file` | Reading or naming a saved login file. |
| `instagram-credential` | A name, a label in either word order, or a password or code control in a file that names Instagram, for an Instagram password, verification code, cookie, or login. A sentence that says none is asked for is fine. |
| `meta-request` | A network call against an Instagram, Facebook, Threads, or Meta host. |
| `request` | Any other network call whose target is not a quoted path on this site, such as `"/api/me"`, and a network function used as a value. The request helpers listed in `NETWORK_ALLOWANCES`, which take the path as a parameter, are the only exception. |
| `meta-host` | Such a host anywhere outside the exact `ALLOWANCES` (the help links and the address parsing rules in `src/domain`), and an allowed bare host that is exported or used for anything but `.has()`. |
| `rewrite` | A rewrite in the configuration or the proxy, which would make a path of this site answer with another host. |
| `dependency` | A runtime dependency that is not in `PACKAGES`, or any dependency named like an Instagram client. |
| `claim` | A claim the capability matrix forbids: tracking paired with automatic, live, or real time, or with "from Instagram", and production paired with ready or grade, in either word order, unless the clause says it is not so. |
| `empty-tree`, `unreadable` | An empty tree, a link, a file that is not text, or a missing `package.json`: what cannot be checked cannot pass. |

`node scripts/check-hosted-rules.mjs` checks this directory, `--app <dir>` checks another app directory, and `<dir>` checks one source tree. `tests/unit/rules/hosted-rules.test.ts` holds a failing fixture for each rejected state and runs the check against the real app, so it runs inside `corepack yarn test:unit`. Nothing runs it in CI or before a deploy yet; [`docs/web/operations.md`](../docs/web/operations.md) section 5 has the step.

To allow a new help link, add the file and the exact text to `ALLOWANCES` in the script, with the reason. A new package or Node module goes into `PACKAGES` or `BUILTINS` the same way; a test keeps `PACKAGES` equal to the runtime dependencies in `package.json`.

It reads text, not a syntax tree. It cannot follow a value assembled at run time from something it cannot read, such as the environment, except that such a value has no way into an import or a request other than the path parameter of a listed request helper. It does not connect meaning across files, such as a heading in one component and a password field in another, and it does not read `scripts/` or `tests/`.

## Repository guard rails for web files

The repository's CI scans the whole checkout with `scripts/public_safety_scan.py`. Every file under `web/` and `docs/web/` has to pass it unchanged:

- no U+2014 character anywhere, including comments and interface copy;
- no absolute path into a home directory;
- no file named `.env` or starting with `.env.`, no file name that contains the word "session" followed by a dot, a hyphen, or an underscore, and no `.db` or `.sqlite` file;
- no token of 40 or more characters from letters, digits, underscore, plus, equals, and hyphen with high entropy. Keep identifiers, test names, and fixture strings short. Hex digests are fine. Never paste base64;
- Yarn 4 is the package manager, because its lockfile uses hex checksums. Do not add an npm or pnpm lockfile;
- any Python file under `web/` has to pass `ruff check .`;
- no `SKILL.md` and no `skills/<name>/` directory under `web/`;
- only synthetic Instagram handles in tests and copy: `atlas_studio`, `nova_labs`, `pixel_forge`, `lunar_arch`, `ember_lab`, `sunset_field`. Test addresses end in `@orbitdiff.test`.

Run the scan from the repository root before you hand work over, on a copy of exactly what git would commit. Do not point it at the working directory: the scanner reads every file under the path it is given, and after `corepack yarn install` the `node_modules/` and `.next/` directories under `web/` hold thousands of files that are never committed and do not pass it. The commands need bash, git, tar, and Python 3.

```bash
SCAN="$(mktemp -d)"
git ls-files -z --cached --others --exclude-standard \
  | while IFS= read -r -d '' file; do [ -e "$file" ] && printf '%s\0' "$file"; done \
  | tar --null -T - -cf - | tar -xf - -C "$SCAN"
python3 scripts/public_safety_scan.py "$SCAN"
rm -r "$SCAN"
```

`--cached --others --exclude-standard` lists the tracked files and the new files that are not ignored, which is what `git add --all` would commit; the loop leaves out tracked files that were deleted in the working tree. CI scans a fresh clone, where nothing is installed, so it can scan the checkout itself.

## Layout

```
drizzle/           generated SQL migrations
scripts/           migrate.ts, check-hosted-rules.mjs, parity helpers
src/app/           pages and the /api route handlers
src/components/    interface components
src/domain/        pure rules with no I/O, pinned to the Python implementation
src/server/        configuration, database, authentication, services, jobs, mail
tests/             unit, parity, integration, helpers, setup
```

Tenant data is read and written only through functions in `src/server/services` whose first argument is the user id. An id that does not exist and an id that belongs to someone else get the same `not_found`.
