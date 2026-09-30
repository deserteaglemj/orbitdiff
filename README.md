# Orbit OS and OrbitDiff

**Your Instagram relationships, stored on your computer.**

Orbit OS combines your own followers/following export with separate public-account watchlists. Search relationships, inspect mutuals and unknown reciprocity, review changes, and export local reports. The OrbitDiff Agent Skill lets a local AI agent operate the same workspace. The standalone desktop app is a separate install.

| Workflow | Source | What a change means |
| --- | --- | --- |
| Your own followers and following | Your supplied Instagram JSON export | Observed between snapshots; refresh with another export |
| Another account's public following | Explicit OrbitDiff scans | Confirmed after two matching complete observations |

No cloud account, telemetry, model API, automatic schedule, or account actions. Viewing, refreshing, reporting, and opening the app do not contact Instagram. Missing, partial, failed, and stale data remain explicit.

## Install for an AI agent

The canonical skill name is **`orbitdiff`**. It supports agents with local command execution and file access, including Codex, Claude Code, Cursor, GitHub Copilot, Gemini CLI, and other Agent Skills hosts. Chat-only agents cannot operate your machine through this skill.

The skill and runtime install separately. Start with the complete [copy-paste setup prompt](docs/prompt.md), or follow the [installation reference](skills/orbitdiff/references/installation.md).

Install version 0.2.1 from the [GitHub release](https://github.com/deserteaglemj/orbitdiff/releases/tag/v0.2.1):

```bash
pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.2.1
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.2.1 --agent codex --scope user
```

The v0.1.1 release does not include personal-export commands. To work from a verified source checkout instead:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/orbit-os --version
.venv/bin/orbit-os demo
gh skill install . orbitdiff --from-local --agent codex --scope user
```

Use the agent host you actually run. GitHub CLI's skill installer is optional: extract the audited skill ZIP and copy the complete `orbitdiff` directory into your host's supported skill directory. Keep its references and assets.

`orbit-os` and `orbitdiff` are both installed by the Python package. Python 3.11+ is required for this route. If pipx is unavailable, use the isolated environment above; on Windows its launchers are in `.venv/Scripts/`. No separate Instaloader install is needed for the built-in human login handoff.

## Install the desktop app

The standalone **Orbit OS.app** candidate bundles Python, the interface, and the shared commands. It is independent of the Agent Skill and does not require an AI agent, source checkout, or separately installed Python.

Use the separate app archive and checksum on the [release page](https://github.com/deserteaglemj/orbitdiff/releases/tag/v0.2.1). Extract it and move Orbit OS.app to an application folder. The app starts its own local server and owns its lifetime; it installs no startup item or daemon.

The initial desktop candidate targets **Apple Silicon macOS**. It uses ad-hoc signing and is **not Developer ID signed or notarized**. Gatekeeper rejected a quarantined copy during verification, so this download is a developer preview and requires proper signing before a normal consumer release. Do not disable platform protections. Windows, Linux, and other architectures remain unverified until their own builds and installation tests pass.

The small `Orbit OS.app` launcher at the repository root is a source-checkout convenience. It is not the self-contained release bundle. Maintainers use the [desktop build script](scripts/build_desktop.py); platform and quarantine evidence accompanies each release candidate.

Technical users can also open the browser interface from an installed runtime:

```bash
orbit-os app --open
```

It listens only on `127.0.0.1`. Close its terminal process to stop the browser server. `orbit-os app --desktop` needs the desktop extra; the bundled app includes it.

## Import your own relationships

For the commands below, retain the executable from your installation: `orbit-os` for a PATH install, `.venv/bin/orbit-os` for the source environment, or `.venv/Scripts/orbit-os.exe` on Windows. The standalone Mac app's executable is inside its actual bundle, commonly `"/Applications/Orbit OS.app/Contents/MacOS/orbit-os"`. Substitute that full command prefix for `orbit-os`; the app adds no PATH command or separate `orbitdiff` executable.

Supply your Instagram relationship export in JSON format as a folder or ZIP. Orbit OS reads recognized followers/following files only.

```bash
orbit-os import EXPORT_PATH --account atlas_studio
orbit-os relationships --json
orbit-os report --format json
```

Use your own account handle. Add `--captured-at TIMESTAMP_WITH_TIMEZONE` only when the export capture time is known. Add `--complete-followers` and `--complete-following` only for directions you declare complete. These are recorded as user assertions, not independently verified completeness.

One follower shard does not prove a complete list. Missing directions preserve unknown reciprocity. Duplicate imports do not create new events, and older or undated imports do not displace a newer dated current snapshot. The importer rejects detectable owner-metadata, workspace-owner, and relationship-root conflicts; username-only export ownership remains your declaration. Such exports also cannot establish identity continuity across renames. See [personal import details](skills/orbitdiff/references/personal-exports.md).

## Track a public following list

Live collection needs a local session created by you in your own terminal:

```bash
orbit-os login LOGIN_USERNAME
```

Never send an agent your password, verification code, browser data, or session contents. Personal imports, demos, and reports require no login.

Then establish a baseline for a public target:

```bash
orbit-os scan atlas_studio --login LOGIN_USERNAME --baseline
orbit-os targets --json
```

At least 30 minutes after the previous attempt, an explicitly requested comparison can run:

```bash
orbit-os scan atlas_studio --login LOGIN_USERNAME
orbit-os report --format json
```

A baseline is silent. One differing complete observation is pending. Another matching complete observation confirms `following_started` or `following_stopped`. Failed or incomplete collection preserves the last good relationship evidence. Initialization, failures, successes, and concurrent attempts share cooldown protection.

Collection stops on private targets, count disagreement, rate limits, redirects, missing sessions, or resource bounds. Limits are 10,000 yielded accounts, 100 queries, one request attempt, a 20-second HTTP inactivity timeout, and a cooperative 120-second collection deadline. This is not a guarantee that a single continuously streaming request finishes within 120 seconds. No automatic retry loop is installed.

## Existing OrbitDiff users

The original `orbitdiff init`, `scan`, `status`, `report`, and offline `demo` remain available. New `targets --json`, `roster TARGET --json`, and `--version` commands make saved evidence discoverable.

Orbit OS defaults to its own per-user application-data directory. The older OrbitDiff default directory is separate. To use an existing watchlist in Orbit OS, select that directory explicitly with `orbit-os app --workspace PATH`. Use the same path as `--data-dir PATH` in original OrbitDiff commands. Existing databases are preserved.

The original local tracker integration is available only through explicit compatibility mode: `orbit-os app --hermes-home PATH`. It remains read-only and does not import those sources into a portable workspace. See the [architecture documentation](docs/orbit-os.md).

For command contracts, JSON meanings, and exit codes, use the [command reference](skills/orbitdiff/references/commands.md). Exit code 0 from a read command is not proof of fresh data: inspect status, dates, coverage, and issues.

## Development and distribution

```bash
python -m pytest -q
ruff check .
mypy src
python -m build
python scripts/build_skill.py --output-dir dist
python scripts/package_audit.py dist/orbitdiff-skill-0.2.1.zip
gh skill publish --dry-run .
```

The skill ZIP uses a deterministic file allowlist, includes the MIT license, and has a SHA-256 sidecar. It contains instructions and assets, not the runtime or user data. Native packages have a separate audit and dependency-license inventory. Build and installation evidence must distinguish local candidates from published, signed releases.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [release checklist](docs/release-checklist.md). Orbit OS is not affiliated with Instagram or Meta.

MIT. See [LICENSE](LICENSE).
