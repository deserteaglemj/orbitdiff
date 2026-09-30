# Skill-led OrbitDiff refinements

The user requested relevant skills and implementation across the existing skill and app. Standing approval covers the bounded implementation and publication. Keep the current local-first architecture and visual identity.

Baseline: v0.2.0. Target release: v0.2.1. Independent plan review: 89/100.

## Implementation [Codex]

1. Apply Skill Creator and the paired prompt-engineering guidance to executable compatibility decisions, inspection without setup side effects, embedded-data boundaries, and evidence-based recovery. Snapshot the prior skill and extend the offline scenario generator. Expected output: portable instructions and runnable synthetic cases.
2. Apply Impeccable harden and clarify guidance to setup draft retention, request state across rendering, keyboard focus, field tokens, and bounded uncertain-outcome recovery. Expected output: usable controls through refresh, navigation, and delayed responses.
3. Apply Superpowers TDD to corrupt DEFLATE handling, plain-text Markdown fields, and cross-platform archive validation. Use focused pytest commands to observe the regressions before implementing their fixes. Expected output: clean error handling, unchanged stored evidence, and rejection of unsafe archive paths.
4. Run the full pytest suite, Ruff, strict mypy, builds, package and native audits, public-safety scanning, skill validation, consuming-agent scenarios, isolated browser checks, and relocated native smoke checks. Freeze versions before building. Expected output: exact audited artifacts, passing CI, a pinned release installation, and a concise evidence report.

## Ownership

- Skill worker: skill resources, onboarding prompt, scenario definitions and generator, related tests.
- Frontend worker: web assets and focused frontend behavior tests.
- Runtime worker: personal ZIP decoding, Markdown reports, associated CLI/HTTP regressions.
- Integrator: archive auditor, release versions, final integration, evidence and publication.

## Failure modes

- A browser timeout can leave a server operation running. Retain an uncertain result and prevent automatic or immediate duplicate submissions; inspect stored status before any subsequent attempt.
- Inspection can mutate storage or conceal unavailable evidence. Route inspection through stored-read commands and compare source hashes, permissions, and modification times in scenarios.
- Corrupt inputs and unsafe paths can enter public artifacts. Test valid-header corrupt ZIPs without state changes, reject Windows and POSIX escape paths and private ancestors, and audit the exact published bytes.

Reuse the installed toolchain within the existing 2 GiB RAM and temporary-disk build budget, with one native build at a time. No new service is required. The Mac app remains an ad-hoc-signed developer preview unless independent signing and notarization evidence changes that status.
