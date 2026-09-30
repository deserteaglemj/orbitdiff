# GitHub and first-use audit

Audit dated 2026-09-30, revised after the founder selected a public-following-first audience. Outcome: partial. The marketing implementation and audit findings are recorded separately from release delivery, fresh host execution, human usability, and live collection. This record separates observed defects, usability hypotheses, and editorial preferences. It is not a customer-research or conversion-success claim.

## Baseline and method

Initial audit baseline: `01cae2acdd4f4d2b1a24f7cba6d62ec79ac343e0`, the merge of PR #4. Marketing revision baseline: `42e393ba6a5083d31f850c465490c11392fe9b43`, the merge of PR #5. Published preview: `v0.2.2` at `f30806c88761ce1b271135dab5c9cc5550a76e8a`. Its assets precede the installation improvements on main. GitHub's Latest release selects stable v0.2.1; v0.2.2 is explicitly a prerelease.

Read the repository and rendered GitHub README, inspected repository metadata and release assets with GitHub CLI 2.100.0, and followed the published installation check. Local environment: Apple Silicon macOS 26.6.2, Python 3.13. Existing commands and assets were retained; no Instagram collection was attempted.

The original README contained 1,179 whitespace-delimited words and no embedded image. Its opening installation section presented the setup prompt, direct terminal commands, source-checkout setup, and archive fallback before a useful first result. These are structural observations; task duration and user confusion need participant evidence.

GitHub returned zero issues and zero discussions at inspection. No participant observations were supplied. Customer language, traffic sources, conversion rates, and popularity are Unproven. There is no customer quotation bank or persona supported by this sample.

## Finding register

All findings below were observed on 2026-09-30. G01-G08 refer to the initial baseline; G09-G12 refer to the marketing revision baseline. Owners are the maintainer except the real-participant prerequisite, which belongs to the user.

| ID | Category / priority / classification | Evidence and reproduction | Impact, smallest fix, and acceptance | State |
| --- | --- | --- | --- | --- |
| G01 | Understanding / P2 / usability hypothesis | Open README: heading gives Orbit OS and OrbitDiff equal prominence; the repository is named orbitdiff. | Newcomers may not distinguish skill, runtime, and app. Lead with OrbitDiff and explain the three pieces. Retest the rendered first screen and participant explanations. | Copy implemented; human impact Unproven. |
| G02 | Starting path / P2 / usability hypothesis | Read README installation opening and docs/prompt.md Task section: several parallel routes and a bracketed list of tasks. | The first action requires route and task selection before value. Recommend one offline setup prompt with a concrete default task; retain conditional manual routes in disclosure/references. Retest exact commands and pilot completion. | Exact project-scope skill and pipx recipes passed; human completion Unproven. |
| G03 | Trust / P2 / verified claim-evidence mismatch | README says it supports named hosts; docs/skill-installation-verification.md records fresh discovery/workflow as Unproven. | A user can mistake placement for working host support. Replace the blanket claim with measured placement and explicit discovery limits. Acceptance: README and evidence table agree. | Fixed and retested against the evidence table and bounded host probes. |
| G04 | Distribution / P1 / verified gap | Compare v0.2.2 skill tree with main and the pinned install commands. Users receive the older skill, despite newer docs on main. | Improvements are not delivered by the advertised version. Label candidate versus published state now; prepare a coherent future release and verify its actual assets before calling delivery complete. | Unresolved: a new version requires locked runtime version files. |
| G05 | Trust / P2 / verified stale documentation | SECURITY.md names 0.1.x and public data only; pyproject.toml is 0.2.2 and the product accepts supplied personal exports. | Reports can target the wrong supported line/scope. Update both statements; retest against current package and documented sources. | Fixed and retested against version sources and the product contract. |
| G06 | Branding / P2 / verified metadata gap | GitHub About mentions public following only; GraphQL reports usesCustomOpenGraphImage=false. | Discovery/sharing omits the personal-export use case and uses a generic preview. Prepare matching description and share asset; acceptance requires live settings readback. | Fixed: description read back and custom preview visibly applied; GraphQL now reports true. |
| G07 | Branding / P2 / verified claim-evidence mismatch | View docs/social-preview.png: broad host claims, any-public wording, and a change being real after two scans. | Shared copy overstates evidence and compatibility. Replace with the two supported sources and accurate limits; visually inspect text/crop and read back configured preview. | Fixed and retested in the image and GitHub preview setting. |
| G08 | First result / P3 / editorial preference | README has no result image although docs/demo.svg exists. | A synthetic example may make the output easier to understand. Embed the labeled illustration with equivalent alt text; inspect rendering and measure interpretation in the pilot. | Illustration embedded; rendering evidence belongs to the PR handoff. Human interpretation Unproven. |
| G09 | Positioning / P1 / verified mismatch with founder direction | README opens with the owner's supplied exports. The founder explicitly selected people asking who a crush or partner started following. | The lead story answers the secondary job. Lead with another account's public following changes, a recognizable relationship-curiosity use case, and a single offline first action. Acceptance: opening, metadata, image, and context agree. | Copy and generated asset implemented; publication checks recorded in the PR handoff. Audience demand Unproven. |
| G10 | Understanding / P2 / usability hypothesis | README does not explain first-observed versus confirmed dates or the lack of exact Follow action time near the public promise. Source stores collection-derived dates. | Readers asking "when" may infer an exact action timestamp. Add a concrete synthetic sequence and date explanation, with baseline and confirmation requirements. Retest against source and advertised release; measure interpretation in the pilot. | Source and release semantics agree; copy and pilot updated. Human comprehension Unproven. |
| G11 | Automation / P2 / usability hypothesis | Existing copy says no schedule is installed but leaves the daily-use path to skill references. | Readers may not understand the next prerequisite. Explain verified manual live use, explicit scheduling, and host support, then link to the authoritative cadence reference. | Prerequisites colocated with the daily-use answer. Live and host gates remain Unproven. |
| G12 | Research / P2 / verified coverage gap | The original pilot has no explicit task on public date interpretation or daily scheduling prerequisites. | A pilot focused on owner exports would miss the new primary job. Add a neutral public-example task and separate evaluator criteria. Acceptance: task uses synthetic data and tests meaning without live collection. | Pilot packet updated. Actual participants remain 0 of 5. |

## Decisions and evidence coverage

The initial audit selected "Understand your Instagram followers and following, locally" from three editorial alternatives. That direction was superseded by the founder's explicit public-following use case after PR #5. Neither headline is a measured conversion winner.

The selected action is "Try the offline demo with your agent". A star/share request would not help a newcomer reach a first result. The opening keeps the evidence limits beside the two workflows. The existing synthetic illustration is labeled; it is not a screenshot or live result.

The skill's current route table distinguishes installation, import, stored inspection, public collection, diagnosis, and scheduling. It conditionally loads references and retains supported metadata and invocation policy. No observed routing defect yet justifies a broad rewrite. Public/private scope and untrusted-input cases remain covered by existing deterministic tests; test results will be reported separately from fresh host behavior.

PR #5 reduced the README from 1,179 to 834 whitespace-delimited words and selected one opening action with a concrete task, retaining manual alternatives in a disclosure. These were editorial and structural changes, not measured improvements in task completion or conversion. The marketing revision adds the public date example and daily-use explanation instead of treating word count as the goal.

PR #5's description led with followers and following locally, with personal snapshots before public observations. Its 218,907-byte JPEG was applied as the custom preview and verified in repository settings. Those were successful publication checks for the previous positioning, not evidence that the story fit the founder's newly specified audience. External social-network cache behavior was not tested.

## Public-following marketing revision

Executed the [reusable audit prompt](marketing-audit-prompt.md) using task decomposition, a claim-to-evidence matrix, accurate/unsupported examples, bounded copy review, and final verification. The founder supplied the audience direction. No new customer interviews, market-size evidence, or demand measurements were invented.

The chosen headline is **"Who did they follow?"** Supporting copy makes relationship curiosity explicit and answers it with public accounts, observed changes, and dates. Personal exports remain a separate secondary use case. The primary action stays the isolated offline demo; both mirrored setup prompts put stored public changes first in their example requests. That example remains a stored read. The runtime and main skill route contracts were preserved.

The relevant provider, event store, report, and local-app profile-link source is identical between the marketing baseline and advertised v0.2.2 tag. The matrix below therefore describes implemented preview behavior, while the separate live gate remains Unproven.

| Reader's question | Supported claim | Source and limit |
| --- | --- | --- |
| Who did they start following? | A public account appeared after the baseline and the same change persisted across two matching complete observations. | [Store](../src/orbitdiff/store.py) and [diff](../src/orbitdiff/diff.py). First baseline emits no events; additions and removals can be pending. |
| Who is that new account? | Reports identify its public username and stable account ID; the local app links to the observed profile. | [Provider](../src/orbitdiff/providers/instaloader.py), [reports](../src/orbitdiff/reports.py), and [app](../src/orbit_os/web/app.js). They do not establish personal identity, gender, or motive. |
| When did it happen? | Original CLI reports expose first-observed and confirmed timestamps. | [Reports](../src/orbitdiff/reports.py), [store](../src/orbitdiff/store.py), and [provider](../src/orbitdiff/providers/instaloader.py). These derive from collection times. The Orbit OS Markdown view shows confirmation time only; do not claim all views show both. |
| Can it show earlier history or every brief follow? | It compares stored observations after a baseline. | [Store](../src/orbitdiff/store.py) and [collection bounds](../skills/orbitdiff/SKILL.md#public-watchlists). There is no historical backfill; changes between scans can go unseen. |
| Can my agent check daily? | A supported host scheduler can be used after verified manual live setup and explicit scheduling authorization. | [Scheduling](../skills/orbitdiff/references/scheduling.md). No job is installed automatically; live and fresh host execution remain separate gates. |
| What about my own followers? | Supplied personal exports support snapshots, mutuals, unknown reciprocity, and comparisons. | [Personal exports](../skills/orbitdiff/references/personal-exports.md). These are not live-confirmed events. |

ChatGPT Image generated the replacement hero in the existing dark-ink and coral orbit direction. It shows only synthetic accounts, a first-observed date, a later confirmed date, and a visible illustration/developer-preview label. It is a concept image rather than an application screenshot. The PNG is the generated source; the JPEG is the README and GitHub upload derivative. Review requires reading the rendered text and checking the crop, not merely finding the files.

The revised pilot explicitly tests which account changed, what dates mean, unknown motives, and the manual-live prerequisite for scheduling. Participant recruitment and sessions remain unperformed. The broader audit outcome therefore stays partial even when the marketing slice passes its implementation checks.

## Verification and measurement limits

The exact final commit, artifact hashes, receipt locations, review results, and CI run identities belong to the PR handoff and the retained private evidence manifest. They must agree before that candidate is called verified. No release tag was moved or published during this audit.

Checks executed with the existing toolchain:

```bash
python -m pytest -q tests/test_agent_prompt.py tests/test_skill_install.py tests/test_skill_package.py
python -m pytest -q
python -m ruff check .
python -m mypy src
python scripts/public_safety_scan.py .
gh skill publish --dry-run .
git diff --check
```

The focused and full suites, Ruff, mypy, public-safety scan, and skill validation passed. Builds use an exported exact Git commit in temporary staging outside the checkout so generated metadata does not touch locked source directories. Candidate and published installation receipts remain separate even when their declared version is the same.

The preserved published preview was checked independently:

```bash
python scripts/check_published_skill.py --tag v0.2.2 --expected-commit f30806c88761ce1b271135dab5c9cc5550a76e8a
```

Pass: release/tag identity, remote asset digests, archive contents, pinned skill-tree installation, installed module origins, both synthetic demos, partial import, unknown reciprocity, and preservation. The README's exact project-scope `gh skill install` command and pinned `pipx install` recipe also passed in fresh isolated destinations. The retained installed executable returned version 0.2.2 and both demo sources.

One fresh Codex CLI 0.144.5 session was attempted with the published skill and runtime, existing login, configured model, and unchanged permissions. It failed during startup because the configured model required a newer CLI; the host also removed skill descriptions after its context budget was exceeded. No task command or task response ran. Fixtures were preserved and the selected workspace remained absent. Record startup as Fail and skill discovery/task behavior as Unproven. No retry was made without a corrected prerequisite.

Claude Code 2.1.283 and Cursor CLI 2026.09.28-64d2043 reported no login. Their fresh task checks remain Unproven. Session use was Codex 1/2, Claude 0/2, Cursor 0/2, with one of six total slots consumed. No account, host, model, or permission settings were changed to obtain a pass.

The [newcomer pilot](newcomer-pilot.md) is ready, and its fixture recipe and interpretation rubric were checked against the installed published runtime. Actual human sessions: 0 of 5 planned. Human comprehension, unassisted completion, and time to first result remain Unproven. The user owns supplying participants; preparation is not participant evidence.

## Minimal next-release proposal

Publication remains blocked on the source-edit boundary. At inspection, v0.2.3 was unused and all current version declarations were 0.2.2. Recheck tag availability before a separately authorized release slice.

The precise locked edits would be:

```diff
--- a/src/orbitdiff/__init__.py
+++ b/src/orbitdiff/__init__.py
@@
-__version__ = "0.2.2"
+__version__ = "0.2.3"
--- a/src/orbit_os/__init__.py
+++ b/src/orbit_os/__init__.py
@@
-__version__ = "0.2.2"
+__version__ = "0.2.3"
```

In that same reviewed slice, align `pyproject.toml` and the skill's `metadata.version`, add the change note, and update advertised pins and expected-version commands to the actually published version. Build wheel, source archive, and complete skill archive from one clean commit; audit and install the exact candidate outside every checkout. Require that commit's CI, retain artifact hashes, then follow the [release checklist](release-checklist.md) and verify the remote tag, assets, and pinned install with the published checker. Keep the desktop preview and live-readiness gates distinct. No partial version bump was made here.

## Remaining gates

- Final candidate installation and exact-head CI are separate from the passed baseline/published checks; consult the PR handoff for their recorded outcomes.
- Fresh authenticated host execution needs the prerequisites described above. File placement and shell runtime success do not fill those gaps.
- Human usability needs the five real newcomer sessions.
- Delivery through the pinned release needs the coherent version slice above. Current users still receive v0.2.2.
- Live public collection remains outside this audit and Unproven. No live Instagram access is authorized here.

Private raw receipts are retained outside public artifacts. Protected source and concurrent work were preserved; live Instagram was not contacted.
