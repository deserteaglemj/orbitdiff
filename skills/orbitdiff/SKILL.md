---
name: orbitdiff
description: Use for OrbitDiff setup, an offline demo, public Instagram following-list changes, or stored history. Routes to release-pinned onboarding, human login handoff, evidence interpretation, and eligible local scheduling.
license: MIT
compatibility: Requires Python 3.11+; live public scans require a human-created local Instaloader session. Agent-host data handling is separate.
metadata:
  openai:
    display_name: OrbitDiff
---

# OrbitDiff

Public targets only. Never accept a password, verification code, raw session material or browser data in chat; use the human login handoff below. Report observed facts and keep personal interpretations unknown.

Inspect the installed command surface before choosing a route:

```bash
orbitdiff --help
```

## Routes

- **Setup or first demo:** read [onboarding](references/onboarding.md). Complete the offline route first and return its receipt. Live use is a separate opt-in.
- **Live collection or session problem:** read [authentication](references/authentication.md) and the live section of [onboarding](references/onboarding.md). The human resolves login locally.
- **Interpret history or a gap:** read [safety](references/safety.md). Report agreement on the relationship change and collection-derived times; whole rosters need not match.
- **Schedule a later check:** read [scheduling](references/scheduling.md) and the release limits in [onboarding](references/onboarding.md). Confirm ownership, cadence and machine availability before changing a scheduler.

## Completion evidence

Name the runtime/release and separate installation, host discovery, offline execution, live collection, scheduling and notification evidence. File placement proves placement only. Keep each unrun gate Unproven. v0.1.1 has no built-in daily notification command.
