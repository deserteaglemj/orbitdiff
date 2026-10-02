# Responsible scheduling

OrbitDiff does not ship a daemon. Use an existing local scheduler only after the offline demo and one successful manual cycle.

- Keep at least 30 minutes after every live attempt for the same target, including baselines and failures. In v0.1.1 the runtime cooldown covers successful scans only; avoid concurrent collection.
- Start with a low-frequency cadence appropriate to the research question.
- Stop rather than retrying rapidly after a rate limit, challenge, private-target refusal, missing session, or incomplete collection.
- Review `orbitdiff status PUBLIC_TARGET --json` after a run. Pending changes need another matching complete scan before they are confirmed.

A local scheduler can invoke the read-only command below. v0.1.1 has no explicit collection request/time bound:

```bash
orbitdiff scan PUBLIC_TARGET --login LOGIN_USERNAME
```

The selected machine and host must be available for a scheduled command to run. Registration and actual unattended execution need separate evidence. v0.1.1 has no built-in daily notification command.

Keep this route read-only and local. Stop for recovery instead of adding account actions, retry loops, account switching, cloud uploads or high-frequency polling.
