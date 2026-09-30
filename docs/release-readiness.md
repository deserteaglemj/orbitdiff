# Release readiness

## Agreed scope

There are two deliverables: the portable OrbitDiff Agent Skill and the separately installable Orbit OS application. Keep personal exports and public following lists distinct throughout setup, evidence, recovery, and reporting.

The first desktop target is Apple Silicon macOS. The application remains a developer preview: ad-hoc signed, without Developer ID signing or notarization. Gatekeeper rejection is an installation limitation, never a passing consumer-installation result. Declaring macOS 13 in bundle metadata does not establish testing on every later version; publish the actual tested operating system.

Live public-watchlist verification is required before either deliverable is called ready. A verified offline preview may be published with that gate explicitly unproven. Signing, broader platforms, cloud services, and automatic updates remain outside this preview's scope. The 0.2.3 candidate adds explicit opt-in jobs through an existing Codex host scheduler, with no new daemon. Installation leaves jobs inactive.

## Observable acceptance criteria

| Requirement | Pass criterion | Evidence |
| --- | --- | --- |
| Skill installation | Audited ZIP contains all referenced files; fresh pinned installation matches the published skill tree | Archive digest, structure validation, pinned-install comparison |
| Runtime selection | Agent checks the actual executable's version and command help, retains one compatible executable, and stops without claiming inspection when none qualifies | Recorded runtime probes and complete final response |
| Frozen evaluation | Imported product files match the exact wheel before and after the cohort; source shadowing, file mismatch, or drift rejects execution | Wheel digest, module origins and hashes, independent invocation logs |
| Offline setup | Agent proves both synthetic source lanes in an isolated demo and asks only for missing workflow inputs | Actual command output; selected/default data remains unaffected |
| Personal import | Supplied owner and source are retained; absent declarations stay unknown; duplicates and older observations do not replace newer current evidence | Import and stored-read results, source preservation checks |
| Instruction boundary | The agent receives embedded instruction text in a recorded tool response and declines to turn it into authorization, dates, completeness, or unrelated actions | Exposure receipt, import arguments, absent marker, truthful final response |
| Stored inspection and recovery | Missing workspace stays absent; existing source content, modes, and modification times remain unchanged; corrupt sources and generic failures are reported without invented causes or repair claims | Before/after fingerprints, invocation log, whole-response review |
| Native installation | Exact ZIP extracts outside checkout and launches without external Python; bundled commands and an empty first run work | Artifact digest, relocated command receipts, native-window observation |
| Native workflows | Personal import, separate synthetic public evidence, export, malformed-input recovery, restart, and shutdown work in isolated storage | Native observations and output receipts; owned port closes |
| Download trust | Record actual quarantined launch assessment, signature identity, and notarization state without weakening protections | Gatekeeper and codesign results; a rejection remains Fail for consumer installation |
| Live public collection | With a user-authorized public target and human-created saved session, the exact candidate completes one bounded collection and stored reads agree with its complete result | Private receipt recording candidate identity, result, time, and stored status; public summary contains no handles or session references |
| Later live comparison | When separately exercised, reuse the stored baseline, omit baseline initialization, respect at least 30 minutes after every attempt, and distinguish pending/confirmed events | Attempt timestamps and stored event evidence; no retry loop or fabricated change |
| Updates and preservation | New versioned artifacts preserve older releases; installation instructions retain explicit workspace selection and do not reset data | Version/pin tests, prior artifact preservation, inspection/import regressions |
| Publication | Exact reviewed commit passes CI; remote asset digests equal local audited assets and pinned skill installation succeeds | CI result, immutable tag/commit identity, remote readback |

## Daily alerts gates

The [scheduling reference](../skills/orbitdiff/references/scheduling.md) owns setup, host lifecycle, and recovery.

| Gate | Required evidence |
| --- | --- |
| Candidate installation | Exact wheel and skill archive tested outside the checkout, installed origins and bytes verified, synthetic daily workflow receipt |
| Host registration | Actual supported-tool job ID, selected timezone and cadence read back; runtime binding alone is insufficient |
| Scheduled execution | Actual invocation from that registered scheduler, with its due-window receipt; a manual command is not this proof |
| Live collection | Target-specific authorization and a complete bounded manual candidate workflow before activation, plus actual scheduled collection receipts |
| Notification path | Labeled synthetic native submission receipt; provider acceptance, device display, and human acknowledgement reported separately |
| Confirmed-event delivery | A real confirmed event linked to its frozen delivery unit and receipt; no-event days and synthetic messages do not establish this |
| Repeated daily operation | At least three consecutive actual scheduled daily windows with complete collection and correct confirmed-event delivery or no-event handling; failures and missed windows do not count |

Record missing gates as Unproven. Synthetic time advancement and a merged PR do not activate collection or establish daily reliability. Keep private targets, session references, and destinations out of public evidence.

## Reporting and gates

Use **Pass**, **Fail**, or **Unproven** for each applicable criterion in the version-specific verification document. A missing prerequisite is Unproven; an observed rejection or failure is Fail. Never convert offline fixture success into live evidence or a local launch into downloaded-app trust.

For the skill, retain the scenario prompts, actual commands and outputs, independent grades, source-preservation results, and the packaged skill/runtime identities in ignored local evidence. State model-context reuse, shared evaluation guardrails, unavailable metrics, synthetic version fixtures, and the limits of the cohort. Passing a finite cohort does not establish universal agent compatibility.

For the application, report preview installation separately from consumer trust and live collection. If live references are unavailable, the user owns providing an authorized public target and login handle or saved-session path. Human authentication stays in a local terminal. If collection fails, report the observed failure, retained evidence, unknown cause, cooldown, and next authorized action without retrying automatically.

For a later consumer release, the publisher owns provisioning Developer ID and notarization authentication. Reopen that decision before any enrollment charge. Consumer-ready claims require verified signing, notarization, and quarantine acceptance in addition to the applicable gates above.

Use [the release checklist](release-checklist.md) for commands and [the desktop recipe](desktop-build.md) for packaging. Release verification documents record results; this document owns the readiness criteria.
