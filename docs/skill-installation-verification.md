# Skill installation verification

Installing skill instructions, executing the runtime, and completing a task in an agent host are separate checks. Live collection remains a separate gate in [release readiness](release-readiness.md). No live Instagram access is part of these checks.

## Candidate check

The dedicated `Skill installation` workflow uses Ubuntu and Python 3.13, already covered by the existing CI matrix. It builds the wheel and portable skill from the checked-out candidate. It does not depend on a future release tag or install a previous release as candidate evidence.

Run the same check locally with the repository's existing development tools:

```bash
python -m build
python scripts/build_skill.py --output-dir dist
python scripts/check_skill_install.py \
  --wheel dist/orbitdiff-0.2.3-py3-none-any.whl \
  --skill-archive dist/orbitdiff-skill-0.2.3.zip \
  --source-commit "$(git rev-parse HEAD)" \
  --expected-version 0.2.3 \
  --require-daily-alerts
```

The checker creates a fresh temporary destination outside the checkout. It installs the wheel and dependencies in an isolated environment, removes source-shadowing paths, validates installed product origins and bytes, and retains one real executable. It checks help, versions, both synthetic demo lanes, and a persisted partial owner import followed by stored reads. Unknown reciprocity stays unknown, supplied fixtures remain unchanged, and default storage must stay absent.

The extracted skill must retain its required references, assets, metadata, version, and compatibility instructions. The JSON receipt records artifact hashes, the supplied source commit, commands, and outcome. A supplied commit is a provenance declaration: run from a clean reviewed commit, and use CI's checked-out commit and retained receipt to identify the candidate. A hash alone does not bind arbitrary local files to a Git commit.

Use a new destination for every run if passing `--output-dir`. The checker refuses an existing directory and a destination inside the checkout. Local receipts and synthetic workspaces are retained for inspection; they are not public product data. Execution is bounded by subprocess timeouts, with no model inference or credentials in CI. Dependency installation uses the existing package index; an offline wheelhouse can be supplied explicitly.

The optional `--require-daily-alerts` check runs the installed daily state machine with synthetic clocks, a synthetic collector, and a recording sender. It proves pending/confirmation, one digest, duplicate-window prevention, and pause behavior. It does not register a host job, contact Instagram, or submit a native notification. The published v0.2.2 check omits this newer capability.

## Published-release check

Run the separate checker against the preserved v0.2.2 developer preview:

```bash
python scripts/check_published_skill.py \
  --tag v0.2.2 \
  --expected-commit f30806c88761ce1b271135dab5c9cc5550a76e8a
```

This uses existing GitHub CLI access to download the Python wheel, source archive, skill ZIP, and checksum manifest. It verifies checksums against both the manifest and GitHub asset digests, audits the archives, compares wheel product files and skill files with the pinned commit's Git blobs, and tests a pinned `gh skill install` in a fresh destination. It then runs the same installed-runtime check with `published` provenance.

Tag identity and asset identities are checked again after installation. Supplying the expected commit rejects tag drift; this does not claim that repository tag protection is enabled. Candidate and published receipts remain separate and must identify their own versions and commits.

The installer comparison explicitly permits only its five observed `github-*` tracking fields (path, ref, repository, tree SHA, and the selected pin), equivalent string-map frontmatter formatting, and removal of one leading body newline. Every original value and body byte must otherwise agree. References and assets must match exactly. The release ZIP additionally carries the repository's MIT license; GitHub's skill-tree installation contains the tree's own files. A different installer schema fails closed for review.

## Host evidence

Host results are recorded for specific versions, platforms, and installation routes. A folder copy establishes file installation only. A command smoke test establishes runtime execution only. Fresh workflow evidence needs an actual new host session that selects the installed skill, reads its references, invokes the retained installed executable, and produces a response supported by command receipts.

Historical v0.2.2 release and prior 0.2.2 candidate placement checks, recorded on 2026-09-30, Apple Silicon macOS 26.6.2. These rows do not establish discovery or execution of the newer 0.2.3 daily-alert skill:

| Host | File placement and references | Host discovery | Fresh skill workflow | Runtime executed by host | Remaining prerequisite |
| --- | --- | --- | --- | --- | --- |
| Codex CLI 0.144.5 | Pass: published GitHub project install and complete candidate archive at `.agents/skills/orbitdiff` | Unproven | Unproven: fresh invocation failed before task execution | Unproven | A host version compatible with its configured model, plus a model-visible skill catalog |
| Claude Code 2.1.283 | Pass: published GitHub project install and complete candidate archive at `.claude/skills/orbitdiff` | Unproven | Unproven: not run | Unproven | An authenticated local host session |
| Cursor 3.21.18; CLI 2026.09.28-64d2043 | Pass: published GitHub project install and complete candidate archive at `.agents/skills/orbitdiff` | Unproven | Unproven: not run | Unproven | An authenticated local host session |

GitHub CLI 2.100.0 placed each published installation in a separate temporary Git project. Each contained the expected 11 skill-tree files, with references and assets compared against the verified release ZIP. The complete candidate archive placed 12 files, including the license, in separate host projects. These checks did not invoke Claude Code or Cursor inference.

The Codex attempt used a new ephemeral session, the existing configured model and permissions, a real installed wheel executable, and a supplied synthetic export. It exited with an error saying the configured model required a newer Codex version. It also reported that the skill context budget was exceeded and skill descriptions were removed. No task commands ran and no assistant task response was produced. Input hashes, modes, and modification times remained unchanged, and the selected workspace stayed absent. This is a failed host startup and Unproven skill behavior, not a successful consuming-agent test.

The attempt used the candidate skill archive with SHA-256 `3391a4a993005305be2094753054d19dacac5eeef098202c75f83a4478d8cce4`, built after commit `70981cc275b587821e5d531f799b5a2461eddcc0`. Final candidate artifact identities belong to the PR's installation receipt. No model substitution, permission change, new login, or automatic retry was used to turn the failed host attempt into a pass.

Separately, the installed-runtime shell checks passed both synthetic evidence lanes, persisted partial imports, unknown reciprocity, and source preservation. The documented archive fallback also passed with real published assets and paths containing spaces. Those results establish installation and offline runtime behavior only. Personal exports remain snapshot observations, never live-confirmed events; public following confirmation requires two matching complete observations.

An unavailable host prerequisite leaves discovery and workflow execution Unproven. Recheck those columns in a fresh session after the prerequisite is available, retain the actual tool receipts and whole response, and keep live collection separate. The previous reused-context evaluation cohort remains historical evidence in [v0.2.2 verification](verification-0.2.2.md); it does not fill these fresh-host gaps.
