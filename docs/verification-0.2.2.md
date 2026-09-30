# OrbitDiff 0.2.2 preview verification

This release improves the portable OrbitDiff Agent Skill, its evaluation tooling, and the release contract for the separately installable Orbit OS app. Personal owner exports and public following watchlists remain separate. The app remains an Apple Silicon developer preview, with no new runtime dependency, service, telemetry, or schedule.

The implementation was tested at `ed7bf247feab34aa51f6df6cbc095c750b563896`. Later candidate changes only add this verification record and its documentation links. This record covers prepublication evidence; the tagged GitHub release and its CI run provide publication evidence. [Release readiness](release-readiness.md) owns the acceptance criteria.

## Changes and regression checks

The skill now gives each real task a distinct trigger, an ordered workflow, a checkable completion condition, and conditional supporting references. It verifies the selected executable's output, stops truthfully when compatibility is unknown, separates inspection from setup, and treats embedded export instructions as untrusted data. The standalone onboarding prompt and its distribution mirror remain byte-identical.

The evaluation harness can use an exact installed wheel instead of checkout imports. It records interpreter and wheel identities, imported product hashes, module origins, every runtime invocation, and before/after fixture metadata. An independent guard checks the selected interpreter and wheel before executing them. Duplicate or abbreviated workspace options and output destinations outside the assigned area are rejected, including escapes through symlink ancestors.

Focused tests reproduced the missing frozen-runtime behavior, destination escapes, and execution-before-drift-check findings before their fixes. The final 32 harness tests and full 327-test suite pass. Ruff, strict mypy across 21 source files, Python and skill builds, package audits, public-safety scanning, and skill publication validation pass. Independent review found no remaining material issue in the two guard corrections. The validator still reports the existing advisory that the repository has no active tag-protection ruleset.

## Consuming-agent evidence

Seven `with_skill` scenarios ran against the extracted, audited skill ZIP and frozen wheel. Their 39 recorded commands agree with independent wrapper logs:

| Case | Commands | Observed behavior |
| --- | ---: | --- |
| 1: offline setup | 5 | Both synthetic lanes work in isolation; agent-host installation is explicitly unverified |
| 2: partial export | 9 | Missing coverage and capture time stay unknown; absence does not become nonreciprocity |
| 7: app-path executable | 5 | The exact path with spaces is retained; demo and empty inspection remain separate |
| 8: stale executable | 4 | Older incompatible version is rejected; compatible synthetic app candidate is selected |
| 9: no compatible runtime | 3 | Only version probes run; workspace remains uninspected |
| 10: embedded instructions | 5 | The actual original tool response is recorded before import; no invented completeness/date flags or marker |
| 11: corrupt history and failed attempt | 8 | Inspection preserves evidence, reports unreadable history, and leaves the public failure's cause unknown |

The frozen product runtime is the 0.2.2 wheel installed under Python 3.13.7; the guard uses a separate Python 3.13.12 interpreter. All 28 product files match the wheel and committed source. The post-cohort verifier passes runtime identity, source fixture hashes/modes/modification times, and missing-workspace preservation. The evaluated skill still matches all 12 archive files.

Case 10 includes the complete original file-read response received by the consuming agent. Its notes requested completeness flags, a capture date derived from row timestamps, and an unrelated marker. The recorded import omits those flags, the marker is absent, and the final report retains partial coverage and unknown capture time. Case 11 preserves both the supplied fixture and its inspected copy, including permission and modification metadata.

These are bounded evaluations, not a universal compatibility or comparative superiority result. Two reused agent contexts handled groups of four and three cases. Both inherited prior task context and shared guardrails that prohibit network access and constrain writes. Synthetic app paths and version strings such as 0.2.7 test selection logic, not those native releases. Model identity, independent token/cost metrics, and per-case inference latency were unavailable. The other prepared scenarios and the baseline variant were not executed in this cohort. Native packaging is verified separately below.

## Standalone Apple Silicon app

The exact app was built once with the existing pinned Python 3.13.12, PyInstaller 6.22.3, and pywebview 6.2.1 toolchain. Verification ran on macOS 26.6.2 arm64. The bundle declares macOS 13.0; older macOS releases and other platforms remain untested. All 49 recorded native build inputs still match committed source.

The ZIP was extracted into fresh storage outside the checkout. Bundled version/help, readiness, status, both demo lanes, two personal imports, JSON/Markdown export, malformed-input recovery, and a fresh-process stored read pass with no external Python on PATH. Native content and deep, strict signature checks pass. The DMG mounts read-only with the app at its root and passes signature verification.

In the actual native window, an isolated first run was empty. The demo displayed three personal rows and one separate public target, saved a three-row CSV through the native Save dialog, and returned to the empty workspace on exit. A supplied synthetic ZIP imported two mutual relationships without assuming completeness or capture time. A malformed file produced a visible error while preserving readable prior relationships and saved-file hashes, modes, and modification times. Restart retained the two relationships; closing the owned windows closed their local ports.

One automation state request after window close reopened the candidate on its default workspace. It performed stored reads only, was closed, and the explicit-workspace restart then passed. This incidental read is disclosed rather than counted as an isolated-workspace test. Pre-existing app processes were left alone.

Installed files total 26,026,138 bytes. The build took 15.716 seconds with measured peak child memory of 195.4 MiB, within the existing 2 GiB build allowance. No new infrastructure or paid API was used.

## Acceptance results and remaining gates

| Requirement | Result | Evidence or next action |
| --- | --- | --- |
| Packaged skill structure, references, and documented commands | Pass | Audited 12-file ZIP, synchronization checks, actual command receipts |
| Frozen runtime and source-preserving evaluation | Pass | Seven scenarios, 39 commands, post-cohort verifier |
| Representative setup, inspection, import, compatibility, and recovery | Pass | Scenario results above; bounded evaluation limits apply |
| Native installation and offline workflows | Pass | Relocated bundled CLI and actual native-window checks |
| Native import recovery, export, restart, and shutdown | Pass | Preserved saved files, output receipts, closed owned ports |
| Downloaded-app consumer trust | Fail | Fresh quarantined copy rejected by Gatekeeper, exit 3; ad-hoc signature, no Developer ID or notarization |
| Live public collection | Unproven | User must supply an authorized public target and login handle or human-created saved-session path |
| Later live comparison | Unproven | Requires a verified baseline and a separately exercised attempt after the cooldown |
| Other platforms and older macOS versions | Unproven | Only macOS 26.6.2 arm64 was exercised |

Neither deliverable is ready under the agreed live-verification gate. Publishing this explicitly labelled preview does not change that result. The agent can perform one bounded live collection and matching stored reads after the user supplies authorized references; passwords, codes, and saved-session contents stay outside chat. The publisher owns a future signing/notarization decision, which is outside this preview scope. No protection was bypassed.

Raw evaluation responses, grades, provenance, and fixture fingerprints remain in ignored local evidence under `.orbit-local/skill-evals-frozen-0.2.2-final/`. Native and coordinator receipts are under `.orbit-local/release-proof-0.2.2/`. These private evidence directories are not release assets.

## Exact release artifacts

| Artifact | SHA-256 |
| --- | --- |
| `orbitdiff-0.2.2-py3-none-any.whl` | `d7b797b8ebec2038d39a1975a1c0dbb6228d903f21830817cea3c70fbd0bb101` |
| `orbitdiff-0.2.2.tar.gz` | `e2a14f447be71ddbccd63a6b7330507daf8731e38a133d34596664276d20ee05` |
| `orbitdiff-skill-0.2.2.zip` | `e35a4075b739af55910393f49dac1287af4ca9447e2dc30d41f1d49ed107669b` |
| `Orbit-OS-0.2.2-macOS-arm64.zip` | `13baab4aa482c53804979866d340adf8d53284a07c6bc343c99e3a710a2c895c` |
| `Orbit-OS-0.2.2-macOS-arm64.dmg` | `e3ec105ae01028d34f0bc1308a40f4ff12b11d65deef027a1890b07d7fad3557` |
