# OrbitDiff 0.2.1 verification

This patch refines the existing portable Agent Skill and local Orbit OS app. It uses the installed Find Skills, Skill Creator, Superpowers, prompt-engineering, prompt-engineering-patterns, and Impeccable guidance. It adds no service, runtime dependency, telemetry, or scheduled process.

## Runtime and interface

- 302 tests pass. Ruff, strict mypy, Python packaging, package-content audits, public-safety scanning, and skill publication validation pass.
- Focused failures were reproduced before fixing corrupt DEFLATE imports, literal Markdown report fields, unsafe archive members, retained setup state, request deadlines, and delayed refresh ordering.
- Browser verification used synthetic exports and a local delayed-response server. Refreshing and navigating preserved form values, the selected file, pending state, and eventual feedback. One import and one synthetic scan were submitted. No live collector ran.
- Pagination moved focus to the enabled peer at the last page. Filters retained focus and announced result counts. The setup view had no horizontal overflow at a 320-pixel viewport. The final Impeccable detector reported no findings.
- Two deterministic delayed-read tests confirm that a completed operation gets a fresh stored read after an older refresh, and failed reads do not discard queued demo/workspace reads. The operation still submits exactly once.
- The wheel installs in a clean environment. Both command versions, isolated readiness checks, and both offline demos pass outside the checkout.

## Consuming-agent evaluation

Eleven synthetic scenarios were run against the updated skill and the preserved 0.2.0 instructions, using the same candidate runtime. Independent grading found 44 of 44 assertions passing for the updated skill and 43 of 44 for the baseline. The baseline's one failure was contradictory reporting after a correct version-only stop, not an unsafe command. All 40 source fixture files and 80 permission/modification metadata entries matched their pre-run assessment.

The scenarios cover partial and dated exports, duplicate and older imports, pending removals, failed collection, private-profile refusal, bundled command paths, incompatible runtimes, embedded export instructions, and corrupt history. Both variants handled the substantive safety cases. These results do not establish statistical superiority or universal agent compatibility: each variant used one grouped agent session, both agents were reused because of a thread limit, app-path fixtures were synthetic, and neither token usage nor complete executor timing was available. Native packaging was verified separately above.

## Apple Silicon developer preview

The exact 0.2.1 app was built with the pinned managed Python 3.13.12 toolchain and verified on macOS 26.6.2 arm64. Native content and deep, strict signature audits pass. The ZIP was extracted outside the checkout; bundled CLI checks and the offline demo run without an external Python executable on PATH. The extracted native window renders the synthetic demo, saves its three relationship rows through the macOS Save dialog, and closes its owned local port when its window closes.

The read-only DMG mount contains the app at its root and passes signature verification. Installed files total 26,026,138 bytes; the ZIP is 12,960,533 bytes and the DMG is 13,920,006 bytes. Peak builder child memory was 195.6 MiB.

This app is ad-hoc signed and not notarized. Gatekeeper rejects a quarantined copy with exit code 3. Protections were not bypassed. Live Instagram login and collection, other operating systems, and older macOS releases were not exercised.

## Exact release artifacts

| Artifact | SHA-256 |
| --- | --- |
| `orbitdiff-0.2.1-py3-none-any.whl` | `09920471b2a008c89ba0b25ad57837240c60836a0f17863d151a3b3dc8852433` |
| `orbitdiff-0.2.1.tar.gz` | `86afa86754699292d7c509d32dfe4827865f8dfcfde80054407525c6b4ef3905` |
| `orbitdiff-skill-0.2.1.zip` | `baa3903c5a9a436efeee585d19b2a99b43580f68b1eab6ba044bef45147033a4` |
| `Orbit-OS-0.2.1-macOS-arm64.zip` | `41d0b242018dd88e2b5ac3d67d1ade674336a96a51e825b0ff75625a73bb8ecf` |
| `Orbit-OS-0.2.1-macOS-arm64.dmg` | `7acca694759cfdf4330ceaf94bef42d2fa80f7b23d1f3f477bd740643a432353` |
