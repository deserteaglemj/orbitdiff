# OrbitDiff

**Understand your Instagram followers and following, locally.**

Give your AI agent a supplied Instagram export and ask who appears in it, which relationships are mutual, and what changed between snapshots. OrbitDiff also supports a separate workflow for observing changes in other accounts' public following lists.

The **Agent Skill** supplies instructions. The separately installed **runtime** supplies commands. **Orbit OS** is the local app that uses the same workspace.

**[Try the offline demo with your agent](docs/prompt.md)**

Start with synthetic data. No Instagram login or personal export is needed for the demo.

![Illustration of the synthetic public-following demo: a baseline, pending changes, then following_started and following_stopped events. No live collection is shown.](docs/demo.svg)

*Illustration of the public-following demo. The shared `orbit-os demo` also includes personal export observations. These examples do not establish live tracking readiness.*

## What you can learn

| Your task | Input | Result and its limits |
| --- | --- | --- |
| Understand your own followers and following | Your supplied Instagram relationship export, JSON folder or ZIP | Mutuals, unknown reciprocity, and differences between supplied snapshots. Export observations are not live-confirmed events. Refresh with another export. |
| Observe another account's public following | An explicitly requested public scan with your human-created local session | A silent starting baseline, pending differences, and confirmation after two matching complete observations of the same relationship change. |

Missing data stays unknown. Failed or incomplete scans preserve the last good evidence. Public collection covers **following lists**, not other accounts' followers, private profiles, posts, or messages.

## Start with the Agent Skill

Use a local agent with file access and command execution. A chat-only assistant cannot run the tool on your computer.

1. Open the [copy-paste setup prompt](docs/prompt.md) in your selected project.
2. Give it to your agent. The default task installs the skill, retains or sets up a compatible runtime, and runs the isolated demo.
3. Look for separate personal and public results, the verified executable, and any unresolved setup steps. A folder copy alone does not prove your host discovered the skill.

The Python runtime route needs **Python 3.11+** and package-download access. The skill and runtime can be installed independently. Existing compatible runtimes can be retained.

<details>
<summary>Prefer terminal commands?</summary>

With an existing GitHub CLI that supports `gh skill install`, run this inside your selected Git project. This example selects Codex; choose your actual host using the [installation reference](skills/orbitdiff/references/installation.md#install-into-the-selected-agent-project).

```bash
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.2.2 --agent codex --scope project
```

That installs instructions only. For a new runtime installation, with Python 3.11+ and pipx already available:

```bash
pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.2.2
orbit-os --version
orbit-os demo
```

Expected: `Orbit OS 0.2.2`, then JSON with separate `personal` and `watchlist` demo data. Keep the actual executable path reported by your installation if it is not on PATH. Stop on an existing installation instead of overwriting it.

Without pipx or skill-install support, use the [verified archive and isolated-environment recipe](skills/orbitdiff/references/installation.md#archive-fallback-and-isolated-runtime). No additional installer is required.

</details>

These commands select the published **v0.2.2 developer preview**. Main-branch documentation and skill improvements can be newer than that release. [Installation evidence](docs/skill-installation-verification.md) separates the published artifacts, local candidates, and host tests. Codex, Claude Code, and Cursor file placement has been checked; fresh host discovery and task execution remain Unproven. Other hosts need their own verification.

## After the demo

Ask your agent to do one task, using your own account handle and selected paths:

> Import my supplied JSON export for `atlas_studio` into my selected workspace. I have not declared either direction complete. Show the relationships and explain what remains unknown.

For an existing workspace:

> Show my stored relationships and changes, including source dates and coverage. Do not collect new data.

Keep exports and session material local. OrbitDiff has no cloud account or telemetry; your AI host's handling of files and command output follows that host's own settings. Personal imports, stored reports, app refresh, and demos do not contact Instagram. Live public collection requires a separate human login and explicit request; [read its boundaries first](skills/orbitdiff/SKILL.md#public-watchlists). No automatic daily schedule is installed.

## Prefer the desktop app?

The separate **Orbit OS.app** bundles the interface and runtime, without requiring an AI agent or separate Python installation. The [Apple Silicon Mac download](https://github.com/deserteaglemj/orbitdiff/releases/tag/v0.2.2) is a developer preview: ad-hoc signed, not notarized, and rejected by Gatekeeper in the recorded quarantined-launch check. Preserve platform protections. [Desktop setup and limits](skills/orbitdiff/references/installation.md#separate-desktop-app).

## Help and compatibility

- **Installation trouble:** [prerequisites, collisions, fallbacks, and verification](skills/orbitdiff/references/installation.md).
- **A missing or partial export:** [personal export interpretation](skills/orbitdiff/references/personal-exports.md).
- **Existing OrbitDiff data:** retain the same explicit path as `--workspace PATH` for `orbit-os` and `--data-dir PATH` for `orbitdiff`; their default directories differ. [Command reference](skills/orbitdiff/references/commands.md).
- **Questions or reproducible problems:** [GitHub Issues](https://github.com/deserteaglemj/orbitdiff/issues). Share synthetic examples and versions. Use the [private reporting guidance](SECURITY.md) for vulnerabilities.
- **Contribute:** [development setup](CONTRIBUTING.md), [release checks](docs/release-checklist.md), and [readiness criteria](docs/release-readiness.md).

Live public collection remains Unproven under the release criteria. Installation and offline demos do not prove live tracking.

MIT licensed. [LICENSE](LICENSE). OrbitDiff and Orbit OS are not affiliated with Instagram or Meta.
