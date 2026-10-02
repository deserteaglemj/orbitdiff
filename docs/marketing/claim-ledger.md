# Claim ledger

Source inspection: October 2, 2026. Selected release: v0.1.1 at `c9357adb`. Remote main differs. Marketing edits do not change the published runtime or import later features. Check results live in [implementation status](implementation-status.md).

Pass means named evidence exists. Fail means a check contradicted a claim. Unproven means the required observation was not performed. Not supported means this release lacks the capability, not a failed live test.

| Claim | Source | Supported wording / status | Missing gate |
|---|---|---|---|
| Who did they follow? | [Store](../../src/orbitdiff/store.py), [reports](../../src/orbitdiff/reports.py) | Source supported: newly appearing public handles with observation history. | Authorized live collection Unproven. |
| Public following only | [Provider](../../src/orbitdiff/providers/instaloader.py), [scope](../../AGENTS.md) | Private targets refused before collection; no followers/content/account actions. | Live refusal untested here. |
| Silent baseline | Store, CLI demo | First unseen target establishes starting state, no event. `init` is not a reset for existing targets. | No pre-baseline history. |
| Confirmation | [Diff](../../src/orbitdiff/diff.py), store | Two accepted complete observations agree on the same relationship change. Whole rosters need not match. | Observational agreement, not exhaustive action knowledge. |
| Complete list | [Validation](../../src/orbitdiff/providers/base.py) | Provider-finished validated list, including >=95% of reported count. | Exact roster coverage not established. |
| When did they follow? | [Model](../../src/orbitdiff/models.py), reports | First-observed and confirmed collection times. | Exact Follow action times unsupported. |
| Failed / incomplete | [CLI](../../src/orbitdiff/cli.py), store | Existing relationships retained; provider/incomplete failures recorded. | Private/missing-session refusals return errors without failed-run rows; retain separate command receipts. |
| Coverage | Observation model | Starts at baseline; brief changes between checks can be missed. | No backfill or continuous activity proof. |
| Login | [Authentication](../../skills/orbitdiff/references/authentication.md), provider | Demo needs no login; live use needs a human-created local session. | No human session/live authority in this run. |
| Local-first | [Paths](../../src/orbitdiff/paths.py), package | Local SQLite; no runtime cloud database/telemetry. | AI-host processing and machine backup/sync separate; no anonymity promise. |
| Easy / 60 seconds | [Pilot](pilot.md) | Unproven; state Python 3.11+, Git, pipx and terminal prerequisites. | Real novice completion/time/help. |
| Any agent works | `gh skill install --help`, skill tree | Named placement syntax checked. | Actual host discovery/execution separate; universal support Unproven. |
| Install proves tracking | [Checklist](../release-checklist.md) | False. Candidate install proves that artifact's install/offline route only. | Independent live/scheduling/delivery gates. |
| Bounded collection | Provider iteration | Unsupported in v0.1.1; no explicit request/account/time bound. | Separate engineering remediation. |
| Cooldown every attempt | CLI, latest successful scan in store | Unsupported; operationally wait 30 minutes after every attempt. Runtime covers successful scans only. | Baseline/failure reservations and concurrency protection missing. |
| Daily checks | CLI; [scheduling](../../skills/orbitdiff/references/scheduling.md) | Guidance for an existing local scheduler only; no lifecycle commands/daemon. | Authorized host setup, actual invocation, machine availability. |
| Automatic notifications | CLI command surface | Unsupported in this release; no alerts CTA. | Supported runtime/transport and actual delivery. |
| Repeated daily operation | No task run receipts | Unproven. | Three consecutive successful actual daily windows; real-event delivery separate. |
| Meaning / fidelity / gender | Minimal fields | Unknown; report observed facts only. | Never inferred from follows. |
| Demand / savings / price | Founder brief, no sessions | Hypotheses, Unproven. | Actual consented research and denominators. |
| Competitor superiority | [Dated study](snoopreport-study.md) | No comparative claim; messaging observations as of October 1 only. | No independent accuracy/traffic/revenue/conversion study. |

## Publication rule

Use selected-release wording and its evidence. Label synthetic examples beside the result. A candidate and published pin are distinct; recheck release identity before launch. A source-supported feature is not a live pass.
