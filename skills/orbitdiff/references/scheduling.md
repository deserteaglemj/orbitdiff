# Explicit scans and cadence

Orbit OS and this skill install no recurring job or background daemon. Opening the app, refreshing, reading relationships, and exporting reports do not scan Instagram.

Do not offer or create a schedule as part of ordinary onboarding. If the user explicitly requests recurring scans, use the agent host's supported scheduling tool and the user's existing authorization. Do not install a second scheduler or silently add a recurring process.

For an authorized schedule:

- Preserve one explicit workspace, target, and human-created login session.
- Keep at least 30 minutes between live attempts for the same target. Baselines, failures, and successful scans all count.
- Start from an already verified manual workflow. A daily attempt is a reasonable low-frequency example, not a guarantee of successful collection.
- Run one bounded scan and inspect stored status. Never add retry loops or overlapping catch-up runs.
- After a rate limit, challenge, missing session, or private-target refusal, surface the failure and require local recovery where needed. Do not treat repeated failures as zero changes.
- Personal relationship exports do not refresh through a public watchlist schedule. They require a new user-supplied export.

The original CLI reports pending differences until a later complete observation agrees. Scheduling does not change this evidence rule or permit account actions, account switching, enrichment, or cloud uploads.
