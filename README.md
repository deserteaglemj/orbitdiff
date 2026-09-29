# Orbit OS

**A private workspace for understanding your Instagram relationships.**

Orbit OS turns existing daily tracking into an interactive local app. Browse your own followers and following, see confirmed changes, search relationships, inspect the accounts you watch, and check the health of every collection source.

The personal graph and other-account following trackers stay separate. Profile follower counts are not presented as a complete named-follower roster. Hidden lists, pending changes, missing sources, stale data, and collection errors are explicit.

## Open the app

Python 3.11 or later is the only app runtime requirement. No install, API key, cloud account, or package download is needed for the local workspace:

```bash
PYTHONPATH=src python3 -m orbit_os --open
```

On macOS, double-click **Orbit OS.app** or **Orbit OS.command** in this checkout. The launcher opens a terminal and your browser. Leave that terminal running while using the app, and press Ctrl+C to stop it. A second launch reopens the running app.

The default address is `http://127.0.0.1:8767`. It is available only on this computer. This is a local browser app with a macOS launcher, not a hosted service or a native macOS client.

Already installed the Python package? Use `orbit-os --open`. To inspect a separate collection home, use `--hermes-home PATH`. A different port can be selected with `--port 8768`.

## Your workspace

- **Overview:** profile counts, confirmed mutuals, relationship coverage, follower history, and recent changes.
- **Relationships:** search and filter known relationships, including confirmed nonreciprocal relationships and unknown reciprocal status.
- **Watchlist:** each watched account's observed following list, confirmed changes, pending observations, and list visibility.
- **Activity:** a searchable timeline with source and date filters. Unattributed follower movement stays anonymous.
- **System:** collection attempts, last successful data, existing schedules, coverage, and recovery guidance.

**Refresh data** rereads existing local artifacts. It does not contact Instagram or run a collector. Existing Hermes schedules continue to own collection. Orbit OS adds no scheduled task, background daemon, notifications, account actions, or paid API usage.

The app automatically reads the personal graph and following-watch artifacts in the local Hermes home. If they are missing, it shows the setup state. There are no sample accounts mixed into live views. See [the architecture and data contract](docs/orbit-os.md) for sources, privacy, and operating details.

Personal artifacts remain outside the checkout. The app reads a verified private snapshot of the personal SQLite database, leaving the source files untouched. It never stores credentials, browser data, or API response bodies. It has no analytics and loads no remote fonts, avatars, or scripts. CSV exports are created only when requested in the interface.

## OrbitDiff collection CLI

Orbit OS is built on the [OrbitDiff repository](https://github.com/deserteaglemj/orbitdiff). The existing public-list collection CLI and portable skill remain available. The workspace app is an additional local interface; the following installation instructions refer to the published OrbitDiff CLI release.

**Track who enters and leaves any public Instagram orbit.**

OrbitDiff is a local-first CLI and Agent Skill for confirmed changes in a public Instagram following list. It stores a minimal SQLite history on your machine, requires two matching complete scans before reporting a change, and never asks for an Instagram password.

![Synthetic OrbitDiff terminal demo](docs/demo.svg)

## Start in 60 seconds: paste this into your AI agent

Copy the block in [docs/prompt.md](docs/prompt.md) and paste it into Claude, Codex, GitHub Copilot, Cursor, Gemini CLI, OpenCode, or any other coding agent. The agent installs OrbitDiff, proves it works with the offline demo, walks you through the one-time Instagram session step you run yourself, and then asks for the first public username you want to track.

Prefer to install by hand? Do this:

```bash
pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.1.1
orbitdiff demo
```

## Why OrbitDiff

- **Local-first:** SQLite stays on your machine. No cloud account, telemetry, or remote database.
- **Public-only:** private targets are rejected before following-list collection.
- **Confirmed diffs:** incomplete scans fail closed and changes need two matching observations.

If the demo fits your workflow, star the repository so other researchers can find it.

## Install the Agent Skill

OrbitDiff ships a portable skill for GitHub Copilot, Claude Code, Cursor, Codex, and Gemini CLI. It teaches agents the public-only boundary, saved-session safety, completeness rules, and pending versus confirmed changes.

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

The commands use GitHub CLI's `--pin` option. Inspect the tag before installation if you need a source review.

## Live workflow

OrbitDiff tracks public following lists only. It does not access private profiles, DMs, posts, stories, contact data, or account actions. It is not affiliated with Instagram or Meta. Follow applicable terms and law.

1. Check local readiness without contacting a target:

   ```bash
   orbitdiff doctor
   ```

2. Create a local Instaloader session in your own terminal. OrbitDiff never accepts a password, verification code, browser data, or raw session material:

   ```bash
   instaloader --login YOUR_INSTAGRAM_USERNAME
   ```

3. Create a silent baseline for a public target:

   ```bash
   orbitdiff init atlas_studio --login LOGIN_USERNAME
   ```

4. Scan later and view confirmed events:

   ```bash
   orbitdiff scan atlas_studio --login LOGIN_USERNAME
   orbitdiff status atlas_studio --json
   orbitdiff report atlas_studio --format markdown
   ```

OrbitDiff enforces a 30-minute per-target cooldown for live scans. It stops on a missing session, private target, provider failure, rate limit, or incomplete list.

## Pending versus confirmed

Suppose `atlas_studio` follows `pixel_forge` in the baseline. A later complete scan sees `nova_labs` instead. Both observations are pending. If the next complete scan sees the same list, OrbitDiff confirms:

```text
following_stopped pixel_forge
following_started nova_labs
```

A contradictory next scan clears the pending observation. A failed or below-95-percent collection leaves relationship state unchanged.

## Command reference

```text
orbitdiff doctor [--data-dir PATH]
orbitdiff init PUBLIC_TARGET --login LOGIN_USERNAME [--session-file PATH] [--data-dir PATH]
orbitdiff scan PUBLIC_TARGET --login LOGIN_USERNAME [--session-file PATH] [--data-dir PATH]
orbitdiff status PUBLIC_TARGET [--data-dir PATH] [--json]
orbitdiff report PUBLIC_TARGET [--data-dir PATH] [--format json|markdown] [--output PATH]
orbitdiff demo [--data-dir PATH]
```

Exit codes: `0` success, `2` policy or saved-session error, `3` incomplete collection or cooldown, `4` local storage error.

## Development

```bash
python -m pytest -q
ruff check .
mypy src
python -m build
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [release checklist](docs/release-checklist.md).

## License

MIT. See [LICENSE](LICENSE).
