# Changelog

All notable changes to this project are documented here.

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
