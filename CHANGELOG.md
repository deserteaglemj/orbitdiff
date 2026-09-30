# Changelog

All notable changes to this project are documented here.

## [0.2.1] - 2026-09-29

- Preserve setup drafts, selected export files, and operation feedback through refresh and navigation. Restore keyboard focus after filtering and paging.
- Bound local control requests and explain uncertain outcomes without automatically retrying an import or public scan.
- Normalize corrupt compressed export errors without changing saved relationship evidence, and render report fields as plain text.
- Reject Windows-style archive escapes and private directory ancestors in public distribution audits.
- Improve the portable skill's runtime compatibility decisions, read-only inspection flow, and treatment of embedded data and unknown errors. Expand synthetic agent scenarios to exercise those boundaries.

## [0.2.0] - 2026-09-29

### Added

- Portable Orbit OS workspace and CLI for personal relationship-export imports, public watchlists, combined reports, offline demo, and app launch.
- Separate personal snapshot coverage, user-declared completeness, capture dates, duplicate handling, owner binding, and observed-change labels.
- Local app views for relationships, watchlists, activity, source health, search, filters, and requested CSV exports.
- Standalone Apple Silicon macOS packaging with a bundled runtime, dependency licenses, checksums, and separate native-bundle audits. The candidate is not Developer ID signed or notarized; other platforms remain unverified.
- Public target discovery, roster JSON with distinct confirmed/observed/pending state, and version reporting in the original OrbitDiff CLI.
- Deterministic Agent Skill archive builder with an explicit file allowlist, license, checksums, private-data exclusions, and symlink rejection.

### Changed

- Preserved the canonical `orbitdiff` skill name while adding both personal export and public watchlist workflows, portable setup, exact command references, and evidence-based reporting.
- Shared live-attempt cooldown across baselines, successful scans, failed attempts, and concurrent reservations.
- Bounded live collection requests, account counts, retries, and cooperative duration; rate limits and redirects stop collection.
- Tightened interpretation of incomplete sources, unknown reciprocity, pending removals, failed-only history, and source freshness.
- Kept compatibility sources read-only through stable private database snapshots and explicit opt-in.
- Reworked the onboarding prompt around existing user authorization, isolated offline proof, human-only login, and no automatic schedules or retry loops.

## [0.1.1] - 2026-09-12

### Added

- A copy-paste agent prompt in `docs/prompt.md`. New users can paste one block into Claude, Codex, Copilot, Cursor, Gemini CLI, or any other coding agent, and the agent installs OrbitDiff, verifies it with the offline demo, then asks for the first public target to track.

### Changed

- README begins with the prompt so the fastest path for a new user is copy, paste, done.
- The OrbitDiff Agent Skill points agents to the same prompt as the canonical onboarding script.
- The release checklist includes a prompt-accuracy check before publishing.

## [0.1.0] - 2026-09-11

### Added

- Local SQLite graph state with WAL, private file permissions where supported, failed-run receipts, and two-scan confirmation.
- Public-only saved-session Instaloader provider and deterministic offline fixture provider.
- CLI commands for doctor, baseline, scan, status, report, and offline demo.
- Portable Agent Skill with safety, authentication, and scheduling guidance.
- Reproducible packaging, pinned CI, public-safety scanning, and release checklist.
