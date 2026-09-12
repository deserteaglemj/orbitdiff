# Responsible scheduling

OrbitDiff does not ship a daemon. Use an existing local scheduler only after the offline demo and one successful manual cycle.

- Keep at least 30 minutes between live scans of the same target.
- Start with a low-frequency cadence appropriate to the research question.
- Stop rather than retrying rapidly after a rate limit, challenge, private-target refusal, missing session, or incomplete collection.
- Review `orbitdiff status PUBLIC_TARGET --json` after a run. Pending changes need another matching complete scan before they are confirmed.

A local scheduler should invoke only the bounded read-only command:

```bash
orbitdiff scan PUBLIC_TARGET --login LOGIN_USERNAME
```

Do not add account actions, hidden retries, account switching, cloud uploads, or high-frequency polling.
