# OrbitDiff Web capability matrix

Checked 2026-09-30. This page is the source of truth for what OrbitDiff Web may claim. Interface copy and documentation must not claim more than this page does.

OrbitDiff Web is a hosted app that sits beside the local product. The Orbit OS app and the OrbitDiff Agent Skill are unchanged and stay local.

## Summary

| Capability | Status |
| --- | --- |
| Owner export identities (followers and following from a supplied JSON export) | **Supported** in OrbitDiff Web |
| Another account's public following identities | **Local-only** (Orbit OS app and the OrbitDiff Agent Skill, with the human's own saved session) |
| Hosted automatic identity collection (followers or following, for any account) | **Unsupported** |

- **Identity path in the hosted app: manual owner export.** The owner requests their own export from Instagram and imports it. Differences between two imports are export observations, not live follows or unfollows.
- **A count change is a count change.** A count that moves from 100 to 103 is net growth of 3. It never names accounts.
- **Background jobs process stored imports.** They are started by a GitHub Actions workflow and never contact Instagram.

## Matrix

| Capability | Status | Where | Evidence and limits |
| --- | --- | --- | --- |
| Owner's follower and following identities from a supplied JSON export | **Supported** | OrbitDiff Web, Orbit OS, the skill | Identities are usernames, so a rename cannot be proven to be the same person. The export is parsed in the browser and only recognized follower and following usernames are sent, with shard numbers and the capture time. |
| Capture time of an export | **Supported as an explicit declaration** | OrbitDiff Web, Orbit OS, the skill | An ISO timestamp with a timezone supplied by the owner. Never a file date, a relationship timestamp, or the import time. |
| Complete coverage of a direction | **Supported as a user assertion** | OrbitDiff Web, Orbit OS, the skill | Effective complete coverage also needs the expected contiguous shards and a known capture time. It is never independently verified. |
| Changes between two owner exports | **Supported, labelled export observation** | OrbitDiff Web, Orbit OS, the skill | The first import is a baseline with no change entries. Additions need the earlier direction complete. Removals need the later direction complete. The recorded time is the interval between the two capture times. |
| Follower and following counts | **Supported where export coverage is complete** | OrbitDiff Web | Shown as a count, and a change as net growth or net decline. No names are attached to a count. |
| Another account's public following identities | **Local-only** | Orbit OS and the skill | Needs a local Instaloader session that the human creates with `orbit-os login` in their own terminal. A complete list means the yielded accounts equal the reported following count, each with a stable profile id. The hosted app does not run Instaloader and does not load a session file. |
| Baseline, pending, confirm, and clear semantics for public following lists | **Local-only in use; ported and fixture-tested in OrbitDiff Web** | `src/orbitdiff/diff.py`, pinned by `src/orbitdiff/fixtures` | First complete observation is a silent baseline. A differing complete observation is pending. A later complete observation of the same change confirms `following_started` or `following_stopped`. Incomplete, private, rate-limited, or failed collection keeps the last good evidence. No hosted source feeds this state machine. |
| Another account's followers | **Unsupported everywhere** | none | The local public lane collects following lists only. |
| Hosted automatic identity collection | **Unsupported** | none | The IG User node has `followers_count` and `follows_count` only. It has no followers edge and no following edge. Business Discovery returns public fields such as `followers_count` for other professional accounts, not usernames. |
| Aggregate counts from the official Instagram API | **Not available on this deployment** | none | Not implemented. It would need a Meta app, Business Verification, and App Review, and would add counts only, never identities. |
| Transactional email to arbitrary addresses in production | **Not available** | none | There is no OrbitDiff sending domain. Staging captures mail. Production registration stays closed until a sending domain exists. |

## What the hosted app never does

- It never asks for an Instagram password, verification code, cookie, or session file.
- It never runs Instaloader, loads a saved session, or scrapes.
- It never reads private profiles, messages, contacts, or posts.
- It never turns a count into a named follower.

## Sources

Retrieved 2026-09-30.

- IG User reference (updated 2026-04-22), fields and edges: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/
- Business Discovery: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- Account insights (aggregate metrics only): https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights
- Webhook fields (no follow events): https://developers.facebook.com/documentation/instagram-platform/webhooks/fields
- Instagram Terms of Use, automated collection: https://help.instagram.com/581066165581870
- Export your information (Accounts Center): https://help.instagram.com/181231772500920
- Vercel cron limits on Hobby (once per day inside a 59-minute window, so it is not the job scheduler): https://vercel.com/docs/cron-jobs/usage-and-pricing
- Local rules this page mirrors: `CONTEXT.md`, `skills/orbitdiff/references/personal-exports.md`, `skills/orbitdiff/references/safety.md`

## What would change a status

| Status today | Prerequisite | Who |
| --- | --- | --- |
| Hosted automatic identity collection: Unsupported | Meta would have to publish an authorized endpoint that lists follower or following identities. None exists. | Meta |
| Official aggregate counts: Not available | Meta developer registration, a Business type app with the Instagram product, Business Verification, and App Review, then an adapter. | Operator |
| Production email: Not available | A domain the operator controls, DNS records for a mail provider, and the provider key configured as a server secret. | Operator |

## Wording rules for the interface

- Never write that OrbitDiff Web tracks followers automatically, in real time, or from Instagram.
- The interface states that automatic identity tracking is unavailable.
- Export differences read "observed in your export between DATE and DATE".
- Count changes read "net growth of N" or "net decline of N".
- A failed job is shown as its own entry next to the last successful result. It never replaces it.
