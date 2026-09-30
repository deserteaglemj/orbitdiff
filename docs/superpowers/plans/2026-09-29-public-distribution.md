# Orbit OS Public Distribution Implementation Plan

> For agentic workers: implement the approved scope using focused failing tests, small changes, focused checks, and logical commits. Execution is approved, including routine follow-on work.

Goal: deliver an independent portable Agent Skill, then a self-contained desktop application using the same local workspace.

Architecture: preserve OrbitDiff's public collector and the explicit Hermes compatibility reader. Add an owned workspace for personal export snapshots and public watchlists. The CLI and desktop consume the same sanitized view model.

Tech stack: Python 3.11+, SQLite, existing HTML/CSS/JavaScript, pywebview, isolated native bundler.

## Constraints and review focus

- Personal exports are user-supplied snapshots, not automatic collection. Distinguish observations from public-list two-scan confirmations.
- No credentials in chat or command arguments, private-profile collection, browser import, cloud storage, account actions, telemetry, or daemon.
- Preserve unknowns for missing shards and incomplete directions. Deduplicate imports, bind the owner, and do not regress current state to an older export.
- Reserve cooldown atomically before every live baseline or scan. Failed attempts retain cooldown and never alter relationship evidence.
- Native packages must run away from the checkout with no external Python. Report architecture, signing, quarantine, and foreign-platform limits accurately.
- Public artifacts use synthetic accounts, relative paths, explicit file allowlists, dependency licenses, and checksums.

## Task 1: Personal snapshot core [Codex]

Ownership: `src/orbit_os/personal.py`, `tests/test_orbit_os_personal.py`.

Produces: `import_export(source: Path, workspace: Path, *, account: str, captured_at: str | None = None, complete_followers: bool = False, complete_following: bool = False) -> dict`; `import_files(files: dict[str, bytes], workspace: Path, *, account: str, captured_at: str | None = None, complete_followers: bool = False, complete_following: bool = False) -> dict`; `load_personal(workspace: Path) -> dict` matching the existing personal view shape.

- [x] Tests first: official JSON shapes, folder and ZIP imports, split followers, mixed accounts, malformed input, unsafe archive paths, resource bounds, duplicate/older/undated imports, missing directions, and observed event labels.
- [x] Run focused tests and capture expected failures.
- [x] Implement bounded import and private atomic storage, with truthful completeness provenance.
- [x] Run focused tests and report interfaces and evidence.

## Task 2: Public watchlist core [Codex]

Ownership: `src/orbitdiff/store.py`, `src/orbitdiff/cli.py`, `src/orbit_os/watchlist.py`, associated store/CLI/watchlist tests.

Produces: existing CLI plus discoverable targets and roster reads; atomic live-attempt cooldown; `load_watchlist(database: Path) -> list[dict]` matching existing watchlist view shape without modifying source files.

- [x] Tests first: cooldown for initialization, failures, concurrent attempts; target discovery; pending removals; legacy database compatibility; naive UTC timestamps; source fingerprints.
- [x] Run failing tests, then implement and pass focused checks.
- [x] Keep public following data separate from personal followers and preserve complete-scan confirmation.

## Task 3: Shared CLI and local controls [Codex]

Ownership: `src/orbit_os/workspace.py`, `src/orbit_os/cli.py`, `src/orbit_os/__main__.py`, `src/orbit_os/server.py`, related tests.

Consumes tasks 1 and 2. Produces `default_workspace() -> Path`, `load_workspace(workspace: Path) -> dict`, isolated demo state, and a CLI with `doctor`, `import`, `relationships`, `targets`, `scan`, `status`, `report`, `demo`, `app`, and `login` commands. Default app launch retains the existing no-subcommand invocation.

- [x] Test empty-workspace isolation, import behavior through the CLI, structured outputs and exit codes, explicit compatibility mode, bounded authenticated local controls, and no implicit collection.
- [x] Implement personal import via bounded uploaded content only, explicit live scans with username-only session handoff, and no arbitrary filesystem or shell endpoint.
- [x] Pass real HTTP and CLI integration checks before frontend integration.

## Task 4: Portable skill [Codex]

Ownership: existing `skills/orbitdiff/`, `scripts/build_skill.py`, skill packaging tests, public onboarding docs. Preserve the canonical `orbitdiff` skill ID while adding the portable Orbit OS workflows. Publish verified updates to its existing GitHub repository as explicitly requested.

- [x] Build standard frontmatter, relative references, portable workflows, and supported-agent installation directions from actual CLI contracts.
- [x] Package using a file allowlist and deterministic archive content; validate archives and checksums.
- [x] Run synthetic agent scenarios for installation, personal import, public pending/confirmed interpretation, and unsupported credential requests. Produce a static evaluation report and obtain independent skill review.

## Task 5: Desktop package and first-run interface [Codex]

Ownership: desktop worker owns `src/orbit_os/desktop.py`, native entrypoint, `scripts/build_desktop.py`, native audit, desktop tests and packaging configuration. Integrator owns `src/orbit_os/web/`, project metadata, and user documentation.

Desktop consumes `OrbitServer(..., workspace=...)`, starts its owned loopback server, opens pywebview, and shuts the server down on window closure. The bundled entrypoint dispatches non-GUI CLI arguments through `orbit_os.cli.main`.

- [x] Test lifecycle and packaging allowlists before implementation.
- [x] Show first-run setup, explicit personal import, isolated demo, and public-target controls with clear status and provenance.
- [x] Build one isolated native artifact at a time within the approved resource budget.
- [x] Verify relocated launch, uploaded synthetic data, navigation, exports, restart, shutdown, and quarantine behavior. Prepare other-platform instructions without claiming verification.

## Task 6: Verification and delivery [Codex]

- [x] Run full pytest, Ruff, strict mypy, Python build, package audit, public-safety scan, and skill validation.
- [x] Install the candidate wheel and skill in isolated directories and exercise documented commands.
- [x] Audit desktop runtime contents separately without weakening strict skill/wheel checks.
- [x] Run independent review, remediate material issues, and repeat affected checks.
- [x] Prepare separate versioned skill and app archives, hashes, and a concise evidence report for the authorized GitHub release. Keep publication and signing status explicit.

## Risk controls and checkpoints

False relationship events are controlled by provenance, completeness, ordering, and regression tests. Machine-dependent installation is controlled by relocated and sanitized-environment launch tests. Private-data leakage and unsafe local controls are controlled by allowlists, bounded input, same-origin protections, and independent review.

The clean pre-implementation commit is the rollback checkpoint. Stage only task-owned files and commit logical verified slices. Do not modify existing personal sources or schedules. The user approved this scope and routine subsequent work; do not repeatedly request the same permission.

## Verification record

- Local runtime: 250 tests passed, Ruff passed, and strict mypy passed for 21 source files. The candidate wheel installed in a clean environment and ran outside the checkout with no source-path injection.
- Skill: local installation, deterministic archive, package audit, public-safety scan, and GitHub skill validation passed. Independent review found no unresolved material issue in its final scope.
- Agent scenarios: all 28 written assertions passed for both the current and previous skill across seven synthetic cases each. Both variants used the current runtime in one grouped session per variant; the previous-skill runner reused inventory context. These checks establish scenario coverage, not a measured superiority claim. The conditional synthetic-launcher warning was not exercised because that case used a native executable. Timing and token usage were unavailable.
- Desktop: the Apple Silicon Mac preview launched after extraction outside the checkout, ran without external Python, supported first-run/demo/import/navigation/CSV flows, and stopped its server on window close. Browser views had no page overflow at 320, 768, and 1440 pixels.
- Distribution limits: the native app is ad-hoc signed, lacks Developer ID signing and notarization, and a quarantined copy failed Gatekeeper assessment. It is a developer preview. Windows, Linux desktop, Intel Mac, and live Instagram collection were not verified.
- Publication: use the existing repository and canonical `orbitdiff` skill ID. Merge only after the final GitHub checks pass, publish the versioned artifacts and checksums, then verify the pinned remote skill installation.
