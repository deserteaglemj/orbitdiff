---
name: orbitdiff
description: Use when tracking or comparing public Instagram following-list changes locally. Installs and operates OrbitDiff with public-only collection, saved-session safety, completeness checks, two-scan confirmation, offline demo, and non-speculative reporting.
license: MIT
compatibility: Requires Python 3.11+, a human-created Instaloader session for live public scans, and no cloud service.
metadata:
  openai:
    display_name: OrbitDiff
---

# OrbitDiff

## Onboard a first-time user

When the human is new to OrbitDiff, use the canonical copy-paste onboarding prompt bundled at [references/onboarding.md](references/onboarding.md). It performs the install, offline verification, credential-free session handoff, and first-target selection in one sequence. Prefer it over improvising an install walkthrough.

## Safety boundary

Public targets only. Refuse private profiles before any collection, even when the human can view them. Do not collect DMs, posts, stories, followers, contact details, location data, or private activity. Never automate account actions.

Never accept a password, verification code, raw session material, or browser data in chat. The human creates their own local Instaloader session in their own terminal. Stop while they do that.

A follow change is not proof of motive, relationship, identity, or sensitive traits. Report only the confirmed public list change.

## Install

Run the offline demo before a live scan:

```bash
pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.1.1
orbitdiff demo
```

Install this skill with GitHub CLI at user scope. These commands were verified against `gh skill install --help`:

```bash
# Default GitHub Copilot host
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.1.1 --scope user

# Claude Code
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.1.1 --agent claude-code --scope user

# Cursor
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.1.1 --agent cursor --scope user

# Codex
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.1.1 --agent codex --scope user

# Gemini CLI
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.1.1 --agent gemini-cli --scope user
```

For manual installation, copy the `skills/orbitdiff` directory into the target host's skills directory and retain the `references` and `assets` subdirectories.

## Authenticate safely

Follow [authentication guidance](references/authentication.md). Ask the human to complete the local login step themselves. Do not request, receive, paste, or store any credential material.

## Workflow

1. Run `orbitdiff doctor` to check local storage and runtime readiness without collecting a target.
2. Run `orbitdiff demo` and verify it reports a baseline, a pending observation, and confirmed changes using synthetic accounts.
3. Confirm the target is public and explain that only confirmed changes will be reported.
4. Ask the human to complete local session setup if needed, then run `orbitdiff init PUBLIC_TARGET --login LOGIN_USERNAME` once. Initialization is silent and creates a local baseline.
5. Run `orbitdiff scan PUBLIC_TARGET --login LOGIN_USERNAME` at a responsible interval. Stop on a private target, missing session, rate limit, provider failure, or incomplete collection.
6. Use `orbitdiff status PUBLIC_TARGET --json` for stored state and `orbitdiff report PUBLIC_TARGET --format markdown` for confirmed events.
7. Explain pending versus confirmed changes without inferring intent. See [safety guidance](references/safety.md).

## Interpretation

- **Baseline:** the first complete list is stored as the starting state. It emits no relationship event.
- **Pending:** one complete scan observed a difference. It is not a reported change.
- **Confirmed:** the next complete scan observed the same difference. OrbitDiff records `following_started` or `following_stopped`.
- **Failed or incomplete:** no confirmed or pending relationship state changes. Investigate the provider state before trying again.

## Scheduling

There is no built-in daemon. Use an existing local scheduler at a conservative cadence and retain the 30-minute per-target live-scan cooldown. Follow [scheduling guidance](references/scheduling.md).

## Verification

```bash
orbitdiff status PUBLIC_TARGET --json
orbitdiff report PUBLIC_TARGET --format markdown
```

A trustworthy run has a public target, an existing local human-created session, a complete collection, and an event confirmed by two matching scans.
