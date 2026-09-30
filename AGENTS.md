# AGENTS.md

## Scope

Orbit OS and the OrbitDiff Agent Skill keep two evidence sources separate: the owner's supplied relationship exports, and confirmed changes in other accounts' public following lists. Keep the scope local-first and Instagram access read-only.

Do not add password arguments, verification-code arguments, browser data import, private-profile access, account actions, cloud storage, telemetry, content collection, a background daemon, or identity enrichment.

## Development loop

1. Write a focused failing test before production behavior.
2. Run the test and capture the expected failure.
3. Implement the smallest safe change.
4. Run focused tests, then the full suite, Ruff, mypy, build, package audit, public-safety scan, and skill validation.
5. Commit one logical slice at a time.

## Public text and data

Use synthetic targets such as `atlas_studio`, `nova_labs`, and `pixel_forge`. Do not commit personal names, private identifiers, saved-session files, databases, reports, local absolute paths, credentials, or copied personal source.

Public text must not contain U+2014 em-dash characters. The public-safety scanner and tests enforce this.

## Agent skills

### Issue tracker

When reading or publishing issues, use GitHub Issues as described in `docs/agents/issue-tracker.md`.

### Triage labels

When classifying an issue, use the role mapping in `docs/agents/triage-labels.md`.

### Domain docs

Before exploring domain behavior, follow `docs/agents/domain.md` and read the root `CONTEXT.md` glossary. For release work, read `docs/release-readiness.md` and the release checklist.
