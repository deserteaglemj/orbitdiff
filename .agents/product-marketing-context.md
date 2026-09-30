# OrbitDiff product marketing context

Updated 2026-09-30. Repository-derived positioning for an existing product. Audience and conversion hypotheses below have not been validated with customers.

## Product and audience

OrbitDiff helps people understand Instagram followers and following locally through an Agent Skill and a separate command runtime. Orbit OS is the app that operates the same workspace. The source is MIT licensed; no paid offer or pricing model is established here.

The initial audience hypothesis is people already using a local AI agent who want to interpret their own supplied relationship exports. A separate advanced workflow observes other accounts' public following lists. A chat-only assistant, private-profile collection, and automatic daily tracking without setup are outside that promise.

Jobs supported by the current tool:

- Understand mutual relationships and unknown reciprocity in a supplied export.
- Compare supplied snapshots while keeping their capture dates and coverage explicit.
- Inspect stored public-following observations and distinguish baseline, pending, confirmed, and failed states.

Product facts come from [the glossary](../CONTEXT.md), [the skill](../skills/orbitdiff/SKILL.md), and [readiness criteria](../docs/release-readiness.md). Those files own the behavior and evidence contract.

## Positioning and voice

Lead with OrbitDiff. Introduce the runtime and Orbit OS as the pieces a user may need for their chosen route. The opening promise is: "Understand your Instagram followers and following, locally."

Use plain, calm, specific language: supplied export, snapshot, mutual, unknown, public following, pending, confirmed. Explain what the reader can learn before implementation details. Prefer an offline example and a concrete next task over a long feature list.

Describe interpretation and user control. Do not imply motives, interpersonal relationships, identity continuity, private access, universal agent support, consumer-ready installation, or live readiness. Proof of installation and proof of live collection are separate. The AI host may handle file contents or command output according to its own settings; local OrbitDiff storage is not an assurance about the host's data handling.

## Objections and alternatives

These are anticipated questions, not customer quotations:

| Question | Supported answer |
| --- | --- |
| Must I connect Instagram to try it? | The isolated demo and personal export imports need no Instagram login. |
| Will it work with my agent? | Local files and command execution are prerequisites; consult measured host evidence before claiming compatibility. |
| Will setup affect my existing history? | The demo is isolated. Use an explicit workspace for real work and preserve existing installations. |
| Is it checking continuously? | It installs no automatic schedule. Live collection has separate prerequisites and verification. |

Manual comparison and doing nothing are plausible alternatives. No comparative superiority, time saving, market demand, or switching behavior has been measured.

## Proof and research gaps

The current audit found no GitHub issues or discussions to analyze on 2026-09-30. There are no supplied customer interviews or pilot results. Do not invent personas, testimonials, adoption figures, conversion lifts, or retention claims.

Use [installation evidence](../docs/skill-installation-verification.md) and the [audit record](../docs/github-usability-audit.md) for observed results and their limits. A demo proves its synthetic workflow only.

## Goal and next action

Help a newcomer understand the promise, choose the correct installation route, and interpret a useful first result. The primary README action is the copy-paste offline setup prompt. Skill-only requests finish with their own installation/discovery evidence. Stars and shares are secondary observations, not activation proof.

Traffic sources, conversion rate, human time to first result, and retention remain unknown. The newcomer pilot measures understanding, task completion, errors, and requests for help using existing tools and synthetic inputs.
