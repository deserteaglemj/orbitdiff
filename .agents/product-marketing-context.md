# OrbitDiff product marketing context

Updated 2026-10-03. Founder-directed positioning for an existing product. Published v0.2.2 and unreleased candidate 0.2.3 have different capabilities. Audience and conversion hypotheses have not been validated with customers.

## Product and audience

OrbitDiff helps people see changes in someone else's public Instagram following list through an Agent Skill and a separate command runtime. Orbit OS is the local app that operates the same workspace. The source is MIT licensed; no paid offer or pricing model is established here.

The founder's selected audience is people curious whether a crush or partner started following somebody new. Lead with that recognizable question and show the account handle and observation dates that the tool can actually provide. This direction comes from the founder's request, not interviews, usage data, or proof of demand. Gender classification and judgments about attraction or fidelity are not product capabilities.

The first-use route is for people with a local AI agent that can access files and run commands. Personal export interpretation remains a separate secondary benefit. A chat-only assistant, private-profile collection, and automatic daily tracking without verified setup are outside the promise.

Jobs supported by the current tool:

- See which public accounts appeared or disappeared from a following list after a starting baseline.
- Ask an agent to report first-observed and confirmed dates, keeping pending changes distinct.
- Inspect stored observations and understand baseline, pending, confirmed, and failed states.
- Separately, understand mutual relationships and unknown reciprocity in a supplied personal export, or compare supplied snapshots with their dates and coverage explicit.

Product facts come from [the glossary](../CONTEXT.md), [the skill](../skills/orbitdiff/SKILL.md), and [readiness criteria](../docs/release-readiness.md). Those files own the behavior and evidence contract.

## Positioning and voice

Lead with OrbitDiff and the reader's question: "Who did they follow?" The supporting promise is public following changes explained by an AI agent. Introduce the runtime and Orbit OS as the pieces a user may need for their chosen route.

Use direct, curious, calm language: who appeared, who disappeared, first observed, confirmed, public following, pending, unknown. Make relationship curiosity recognizable without encouraging suspicion or treating a follow as a relationship verdict. Prefer a labeled synthetic example and a concrete next task over a long feature list.

Explain what an observation establishes and leave unknowns explicit. The source contracts above govern identity, scope, confirmation, and scheduling. Keep first-observed and confirmed dates distinct from the exact Follow action time, and explain that history begins with setup. Keep the developer-preview status and separate live-readiness gate beside the primary action. The AI host may handle file contents or command output according to its own settings; local OrbitDiff storage is not an assurance about the host's data handling.

Use the dark ink, warm off-white, and coral orbit identity from the repository image. Generated results must say they are synthetic illustrations. Show public account handles and observation states instead of people, gender symbols, or invented application screens.

## Objections and alternatives

These are anticipated questions, not customer quotations:

| Question | Supported answer |
| --- | --- |
| Can I see who they started following? | Complete observations can reveal a public account added after the baseline; the same change needs another matching complete observation before confirmation. |
| Can I see exactly when it happened? | The report records when the change was first observed and later confirmed, not the platform's action time. |
| Who is that person? | The result identifies the public account handle and ID. The app links to the profile; personal identity and motives remain unknown. |
| Must I connect Instagram to try it? | The isolated demo and personal export imports need no Instagram login. |
| Will it work with my agent? | Local files and command execution are prerequisites; consult measured host evidence before claiming compatibility. |
| Will setup affect my existing history? | The demo is isolated. Use an explicit workspace for real work and preserve existing installations. |
| Can it check every day? | Candidate 0.2.3 implements opt-in Codex jobs and macOS notifications. Published v0.2.2 lacks those commands. Follow the scheduling reference after manual live verification and explicit activation; installation stays inactive. Actual daily operation remains Unproven. |

Manual comparison and doing nothing are plausible alternatives. No comparative superiority, time saving, market demand, or switching behavior has been measured.

## Proof and research gaps

The current audit found no GitHub issues or discussions to analyze on 2026-09-30. There are no supplied customer interviews or pilot results. Do not invent personas, testimonials, adoption figures, conversion lifts, or retention claims.

Use [installation evidence](../docs/skill-installation-verification.md) and the [audit record](../docs/github-usability-audit.md) for observed results and their limits. A demo proves its synthetic workflow only. Before preparing public claims or recruiting a study, use the current [claim ledger](../docs/marketing/claim-ledger.md) and [pilot](../docs/marketing/pilot.md).

## Goal and next action

Help a newcomer answer which account changed and what the dates mean, choose the correct installation route, and interpret a useful first result. The primary README action is the copy-paste offline setup prompt. Skill-only requests finish with their own installation/discovery evidence. Stars and shares are secondary observations, not activation proof.

Traffic sources, conversion rate, human time to first result, and retention remain unknown. The newcomer pilot measures understanding, task completion, errors, and requests for help using existing tools and synthetic inputs.
