# Pilot packet

Prepared for v0.1.1; no sessions have occurred. Current counts: comprehension 0/5, setup 0/5-10. Instruments are ready, results are Unproven.

## Recruitment drafts

Approval and exact recipients are required before sending. Keep recipient names private.

**Comprehension invitation:** "Would you try a 15-minute adult-only research session about OrbitDiff, a tool for public Instagram following observations? You'll view a fictional example and explain what it means. No Instagram login, real targets or account data. Participation is optional; you can stop or skip any question. This is research, not a product endorsement."

**Setup invitation:** "Would you try a 30-45 minute adult-only offline setup study? OrbitDiff is a Python CLI plus agent instructions. You need a local coding agent and terminal access. We will record prerequisite time, help and failures, including missing tools. No Instagram login or collection. You can stop at any point. Please don't share credentials or private account data."

[User] Supply five willing unfamiliar adults and 5-10 compatible preview users, or approve those drafts with exact recipients. Overlap is allowed only when recorded. No agents or simulated novices count as participants.

## Consent script

"We are testing the explanation and setup, not you. We will use fictional accounts only. May we keep brief notes about your answers and setup difficulties? You may decline, skip questions or stop. We will use an anonymous participant ID. Recording audio/video requires separate consent. We won't publish your name, quotation or recording without specific permission."

Record adult self-attestation, participation/notes consent, optional recording consent and quotation permission separately. Collect no age, relationship status, Instagram account or credentials. Tell each participant the deletion/contact process and agree a retention date before recording. Default proposed retention: 30 days after analysis; deletion requires the owner's explicit authority. Minimized anonymous aggregate findings may be retained with consent.

## Facilitator procedure

1. Confirm consent and assign a private ID. Record exposure copy version and date.
2. Before sessions, shuffle first exposure across two M1, two M2 and one M3 slots. Freeze the assignment privately. Show exactly that [card](assets/message-cards.md), without teaching.
3. Record the first unaided answer verbatim with notes consent. Then show the common [prototype](assets/walkthrough.html) and ask the tasks below.
4. Do not correct answers until the unaided response is stored. Mark assistance separately.
5. After primary scoring, show other variants in a counterbalanced order. For two slots sharing an initial card, use opposite remaining-card orders. Record every exposure. Later preference is exploratory, not conversion evidence.
6. Debrief with the evidence definitions. Ask what was confusing and whether the example felt helpful or increased uncertainty. Never solicit personal monitoring targets.

The private assignment/template is outside Git. Exact copy is frozen in the message-card file; keep a private copy with the study's version/hash so later edits cannot alter its historical stimulus.

## Participant-only comprehension tasks

Show this section without the rubric.

1. In your own words, what would you use OrbitDiff for?
2. Which account changed in the example, and whose public list was observed?
3. What do October 1 and October 2 mean? What time can the tool not tell you?
4. What happens on the first check? What does pending mean?
5. What would an incomplete check let you conclude?
6. What would you need to try the demo? Would the demo require Instagram login?
7. Would this release automatically check every day and send alerts?
8. Try finding the offline setup action. Stop wherever you would naturally stop.

## Evaluator-only rubric

Score first unaided responses. Keep a separate helped score after clarification.

| Criterion | Correct understanding |
|---|---|
| Scope | Public following list, not followers/private activity. |
| Handle | pixel_forge appeared in atlas_studio's observed list. |
| Dates | First observed / later confirmed, not exact Follow action. |
| Baseline | Starting state, no new-follow batch. |
| Pending | One accepted complete changed observation; another agreeing observation needed. |
| Gap | Existing evidence retained; no new conclusion. |
| Setup | Local terminal/agent, Python/Git/pipx prerequisites; synthetic demo needs no login. |
| Readiness | v0.1.1 preview has no built-in automatic daily alerts; demo is offline only. |

Primary diagnostic target: at least 4/5 independently get scope, handle, dates, baseline and pending right. Report each criterion as n/5, not only a composite. Also report gap/setup/readiness errors and demo completion. Any exact-time, private-access or automatic-alert misunderstanding requires copy review even if the composite passes.

Five people do not establish a winning message or statistical lift. If differences are inconclusive, retain M1 and fix shared misunderstandings.

## Setup observation

Record the selected runtime/source, host and OS with permission; use synthetic data only. Participant runs the [offline prompt](../prompt.md). Do not install globally, upgrade tools or change host configuration without their authority.

Observe prerequisite check, runtime install, command discovery, scratch doctor, demo and interpretation. Record elapsed prerequisite time separately from install/demo time, assistance type, exact redacted errors, retries, stop reason and whether existing runtime/data were preserved.

Keep all invited and started users in the appropriate denominator, including missing prerequisites. Distinguish autonomous completion, completion with help and failure. A coding-agent run here is participant setup evidence, not universal host compatibility.

## Private records

Use the task's authorized private research directory, mode 0700; files 0600. No raw responses, recipients, recordings or personal details in Git. These modes do not attest absence of machine backup/sync.

Fields: anonymous ID; consent/retention choices; exact stimulus/version; first card; full exposure order; first unaided response; criterion scores; help; prerequisites; phase times; completion; redacted error; stop reason; voluntary language; quote consent; follow-up permission.

Public summary: counts, denominators, anonymous failure themes and copy fixes. Publish quotations only with specific quote consent and publication approval. [Measurement](measurement.md) defines the funnel and missing-data handling.
