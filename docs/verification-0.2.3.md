# 0.2.3 candidate verification

Recorded October 3, 2026. Outcome: **partial**. This is an unpublished local developer preview. Published v0.2.2 and its installation proof remain separate. [Release readiness](release-readiness.md) owns acceptance criteria.

| Gate | Result and scope |
| --- | --- |
| Runtime regressions | Pass: 449 tests, including 250 bounded generated examples across three properties, plus Ruff and mypy. New failing cases preceded production fixes. |
| Candidate wheel and skill | Pass: fresh installation outside the checkout, isolated imports, version/help and synthetic daily workflow. Product and skill bytes were independently compared with Git blobs. |
| Published v0.2.2 installation | Pass: pinned release/tag, checksums, wheel product bytes and installed skill tree checked separately. It lacks 0.2.3 daily commands. |
| Packaged browser UI | Pass: 23 rendered states, synthetic source lanes, import/recovery/export/reload, keyboard skip/search focus, 390/768/1440px, doubled computed text sizes at 390px, no axe violations or external requests. Human browser zoom and screen-reader use remain Unproven. |
| Relocated native app | Pass on macOS 26.6.2 arm64: bundled CLI without external Python, empty first run, synthetic demo, native CSV save, ZIP import, malformed-input refusal, preserved snapshot, restart and owned-server shutdown. |
| Native integrity and DMG | Pass: content audit, strict ad-hoc signature and read-only mounted app. Build peak child memory was 210 MiB within the existing 2 GiB budget. |
| Consumer trust | Fail: a separate quarantined copy was rejected by Gatekeeper with exit code 3. No protections were changed. Developer ID and notarization are outside this preview. |
| Fresh Codex, Claude Code and Cursor use | Unproven: frozen paired synthetic scenarios are prepared; no new host session was run or claimed. |
| Live collection and later confirmation | Unproven: Instagram was not contacted. Target-specific authorization and human-created authentication references are required. |
| Actual scheduler, submission, device display and human read | Unproven: no schedule or notification was activated. Runtime configuration and tests do not establish these gates. |
| Real-event delivery and three consecutive daily windows | Unproven: requires authorized operation and real calendar evidence. No-event handling does not establish event delivery. |
| Exact-head CI and publication | Unproven for the local branch: current main's green CI covers a different commit. Push, PR and release require exact approval and subsequent readback. |
| Human comprehension/setup | Unproven: study criteria and current synthetic media are prepared; zero participants. |

The fixes preserve confirmation thresholds, shared cooldown and existing data. A late known session failure now blocks an interrupted job once, stale completions cannot reblock recovered work, successful recovery records one notice, and expired acknowledgements stay uncertain. Successful notification submission no longer hides a collection block. System displays the actual portable job's evidence and uses "Submitted" without implying device delivery.

## Reproduce local checks

Use the repository's existing development environment. Build the wheel and skill archive from the selected clean commit, then run `scripts/check_skill_install.py` with the full source commit, expected version and `--require-daily-alerts` in a new output directory outside the checkout. Independently compare archived product/skill bytes with that commit; the commit argument alone is not proof. Keep private receipts with artifact hashes, module origins, actual commands and preservation results.

`scripts/check_app_ui.cjs BASE_URL TOOL_ROOT NEW_OUTPUT_DIRECTORY` requires an explicitly selected empty disposable loopback workspace. It blocks external requests and the live scan endpoint. Its browser dependencies come from the separately installed development tools, not the runtime wheel. The native checks use the existing pinned desktop recipe and a relocated bundle.

Installation leaves collection inactive. The supported candidate activation route is the existing Codex host scheduler with macOS current-user notifications. The Mac, logged-in user, host, retained runtime, workspace and human-created session must remain available. To pause an authorized job, use `orbit-os alerts pause JOB_ID --workspace WORKSPACE` and pause the matching host job according to the [scheduling reference](../skills/orbitdiff/references/scheduling.md). No notification destination has been verified in this candidate audit.
