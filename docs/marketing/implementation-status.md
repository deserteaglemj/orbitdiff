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
| Candidate package / skill checks | Receipt below | Initial local checks passed; final exact-commit proof pending |
| Personal and independent review | Receipt below | Pending |
| PR / distribution handoff | Publication pack | Local draft; no push, PR, CI or publication |

## Verification receipt

Initial observations: focused prompt/skill checks passed; full pytest passed; Ruff passed; mypy passed for 12 source files. Build produced wheel/sdist; package audit and public-safety scan passed; `gh skill publish --dry-run .` passed with a tag-protection warning. These are local evidence, not remote CI.

Final exact-commit install, origins, checks and hashes will be recorded from actual execution. Skill archive verification is Unproven: this checkout has no dedicated skill-archive packaging route. Existing tree validation is separate from placement or host discovery.

No live collection, authentication, scheduling, notification submission or repeated-daily operation occurred. Those gates are Unproven or unsupported in the selected release. Human comprehension/usability/market validation are Unproven with zero participants.

Costs: $0 incremental paid media/research/generation spend. Existing account usage/local compute are not priced here. No paid generation attempted. Private research templates and verification receipts remain outside Git.

## Review receipt

Pending one independent read-only review and the author's complete-diff review. Material findings will be fixed locally and affected checks rerun. Public CI is Unproven until an exact candidate head is actually submitted and observed.
