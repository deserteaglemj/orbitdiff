# Marketing implementation status

Prepared October 2, 2026. Overall outcome: **partial** until human research, feedback-dependent final creative and approved distribution actually happen. Local production and verification are tracked below.

## Identity and integration

- Base: `c9357adb`, runtime/release v0.1.1, public-following preview.
- Remote main observed at `cad6b27b`; later product work is outside this selected route.
- GitHub release inventory also shows v0.2.0, v0.2.1 and prerelease v0.2.2. v0.1.1 is not the newest release.
- Candidate branch: `codex/marketing-public`, isolated managed worktree.
- No runtime, web, global skill/configuration or unrelated checkout edits. No Instagram contact or recurring job activation.
- Do not merge this old-release-based branch wholesale into current main. Selectively integrate marketing files on an approved destination base, reconciling claims and pins with its evidence. This candidate is reviewable local work, not a ready main-targeted PR.

## Coverage matrix

| Brief requirement | Artifact / evidence | State |
|---|---|---|
| Audience, job, switching, voice, proof | [Context](../../.agents/product-marketing-context.md), [messaging](voice-and-messaging.md) | Draft implemented; customer assumptions unvalidated |
| Release-specific claims | [Ledger](claim-ledger.md) | Source audit implemented |
| Snoopreport inspiration | [Study](snoopreport-study.md) | Dated snapshot reused; refresh Unproven |
| Question-first repo journey | [README](../../README.md) | Implemented |
| Offline-first setup / router | [Prompt](../prompt.md), [skill](../../skills/orbitdiff/SKILL.md) | Candidate implemented; published pin retains its own text |
| Prototype and variants | [Manifest](assets/manifest.md), [walkthrough](assets/walkthrough.html) | Usable original synthetic prototypes |
| Five-adult comprehension | [Pilot](pilot.md) | Instrument/assignment ready; 0 participants |
| Five-to-ten-user setup | Pilot, [measurement](measurement.md) | Instrument ready; 0 participants |
| Final preview/card/carousel/videos | [Creative pack](assets/creative-pack.md), original vectors | Provisional usable assets/scripts; final selection, generated master/raster export and recorded media pending |
| Three linked guides | [Following](content/who-did-they-follow.md), [times](content/observation-times.md), [agent](content/agent-history.md) | Drafts implemented |
| Owned/Rented/Borrowed | [Distribution](distribution.md), [publication pack](publication-pack.md) | Exact drafts ready; accounts/creators/recipients pending, nothing sent |
| Manual funnel | Measurement | Instrument ready; no results or telemetry |
| Pricing research / decision | [Pricing](pricing.md) | Questions/deferral memo ready; no purchase evidence |
| Staged launch | [Checklist](launch-checklist.md) | Gates prepared; no launch claimed |
| Candidate package / skill checks | Receipt below | Local checks and isolated installs passed; exact tested head/hashes in private final receipt |
| Personal and independent review | Receipt below | One material layout finding reproduced and fixed |
| PR / distribution handoff | Publication pack | Local draft; no push, PR, CI or publication |

## Verification receipt

Observed checks: focused prompt/skill tests 11 passed; full pytest 50 passed; Ruff passed; mypy passed for 12 source files. Wheel/sdist build, package audit, public-safety scan and `gh skill publish --dry-run .` passed. The CLI warned about absent tag-protection rules; no settings were changed. These are local checks, not remote CI.

Candidate wheel and published v0.1.1 runtime were installed in separate temporary environments outside the checkout. Help, scratch doctor and demo succeeded from those environments. Isolated Python imports resolved to their site-packages, with no checkout/source shadowing. Published pipx installation resolved to the v0.1.1 source commit `c9357adb`.

Candidate and published skills were placed into separate temporary custom directories, outside active host skill folders. The eight candidate files were present; resources byte-matched, and the skill body matched apart from one leading blank removed by the CLI. Tracking metadata was added locally. This proves placement, not host discovery.

Exact final commit, artifact hashes, command logs and installed origins are in the private verification receipt. Skill archive verification is Unproven: this checkout has no dedicated archive packaging route. No claim of active host discovery or universal compatibility is made.

Local Markdown targets were checked across 25 documents; five SVGs parsed. Browser inspection observed baseline, confirmed and gap states. A 390px overflow failure was reproduced before the layout fix; afterward all four frames fit at 390px and default desktop. The animation wait helper timed out once; the actual rendered page and direct DOM measurements were used rather than treating that timeout as a product pass.

Commands used: `python -m pytest` (focused and full), `ruff check .`, `mypy src`, `python -m build`, `python scripts/package_audit.py`, `python scripts/public_safety_scan.py .`, `gh skill publish --dry-run .`, isolated `pipx install` at v0.1.1, clean-venv candidate-wheel installation, `orbitdiff --help`, scratch `doctor`, `demo`, isolated module-origin checks, and temporary custom-directory `gh skill install`.

No live collection, authentication, scheduling, notification submission or repeated-daily operation occurred. Those gates are Unproven or unsupported in the selected release. Human comprehension/usability/market validation are Unproven with zero participants.

Costs: $0 incremental paid media/research/generation spend. Existing account usage/local compute are not priced here. No paid generation attempted. Private research templates and verification receipts remain outside Git.

## Review receipt

One fresh read-only review assessed Standards and Spec separately. It found one material issue: the confirmed frame clipped at 390px (463px content inside 440px). Intrinsic grid sizing fixed it; the same DOM check passed afterward. No material claim/privacy issue or deferred minor was identified in the inspected candidate.

The author reviewed the full change set, checked source boundaries and corrected the welcome draft to target the revised candidate guide only after an approved push/readback. Runtime files and unrelated work were preserved.

Independent rendered playback, final package receipts, host discovery, live collection, customer comprehension, fresh competitor research and publication readiness were explicitly outside the reviewer's verified evidence. The author's package/DOM checks do not erase those distinctions. Public CI remains Unproven until an exact submitted head is observed.
