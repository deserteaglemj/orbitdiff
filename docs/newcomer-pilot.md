# Newcomer pilot

Purpose: measure whether real newcomers can understand OrbitDiff, choose a route, reach the offline demo, interpret a supplied export, and find help. This packet is prepared; no participant sessions have been run.

Use five people who have not maintained OrbitDiff. The user supplies participants or separately authorizes recruitment. Keep anonymous IDs P01-P05 and synthetic inputs. Use existing local agents, authentication, and tools; note missing prerequisites instead of changing accounts, installing new agent hosts, or buying access.

## Facilitator setup

Use a fresh selected Git project and an explicit candidate or published ref per participant. Record the README ref, skill tree, runtime artifact digest, host/version, operating system, and whether prerequisites already exist. Give participants the corresponding rendered README, the supplied export path below, and an unused workspace path. Never use their personal exports or sessions.

Create the synthetic export in a new directory. Run this once from the selected pilot project; it refuses an existing destination:

```bash
python3 - <<'PY'
import json
from pathlib import Path

root = Path("pilot inputs")
root.mkdir()
export = root / "provided export"
export.mkdir()
def row(name):
    return {"string_list_data": [{"value": name, "timestamp": 1}]}
(export / "followers_1.json").write_text(json.dumps([row("nova_labs")]))
(export / "following.json").write_text(json.dumps({
    "relationships_following": [row("nova_labs"), row("pixel_forge")]
}))
print(export.resolve())
PY
```

Retain fixture hashes, permissions, and modification times before and after use. Keep the chosen workspace absent until the requested import. Do not add capture-time or completeness declarations to the packet.

For recovery, give everyone the same separate scenario card: "A different machine has no orbit-os executable. Find what you would do next." Do not remove an installed tool to simulate this. Record recovery as a documentation task, not a successful installation on that machine.

## Participant instructions

Share only this section and the named materials, not the evaluator rubric below. Substitute the supplied paths and project before the session. Do not add hints or expected answers.

1. Open the README. In your own words, explain what OrbitDiff helps you do, what you would need to provide, and whether it fits your situation.
2. Starting from that page in your selected project, get a working example result without using your real Instagram account. Explain what you did and what the result tells you. Use the docs as you normally would.
3. Import the supplied export for atlas_studio into the selected workspace. Explain what the result says about nova_labs and pixel_forge, and what it tells you about changes happening right now.
4. Read the missing-executable scenario card. Find the next step and explain where you found it.

You may stop at any time. Ask for help when you normally would; the facilitator will record where help was needed. Do not provide credentials or run live Instagram collection.

## Evaluator rubric, keep separate during the task

Use observed actions and the participant's complete explanation. Do not correct them while timing an unassisted attempt. If safety requires an intervention, stop that action and record an assisted/incomplete outcome rather than silently excluding the session.

| Task | Observable acceptance |
| --- | --- |
| Understanding | Explains the tool's purpose and necessary input, and distinguishes instructions from commands. |
| First result | Completes the selected installation/setup route and runs the isolated offline demo. Can identify the separate personal and public sources. Placement alone does not count as host execution. |
| Interpretation | Recognizes nova_labs as mutual in the supplied snapshot; leaves pixel_forge reciprocity and capture time unknown; does not call snapshot differences live-confirmed events. |
| Public evidence | Explains that confirmation needs two matching complete observations and that an offline demo provides no live collection proof. Score from the participant's explanation without supplying this answer. |
| Recovery | Finds the installation guidance, identifies the missing runtime prerequisite, and chooses a supported route without proposing an overwrite or claiming an unperformed repair. |
| Preservation | Fixtures retain contents/modes/times; real/default history is unchanged; only the selected synthetic workspace is populated. |

## Record and analyze

For each anonymous participant record:

- Candidate/release identity, host/version, operating system, prerequisite state, and prior relevant experience.
- Time started, time to first useful result, and time spent obtaining prerequisites, reported separately.
- Per-task Pass, Fail, or Unproven, plus assisted/unassisted status.
- Exact failed commands, errors, help requests, hesitation points, and the participant's own explanation.
- Stop reason, preservation results, and which observations support each conclusion.

Keep raw notes and traces private. Publish only consented, anonymized observations and synthetic examples. Screenshots or quotations require review before inclusion in public artifacts.

Initial target: at least four of five real newcomers reach the offline demo without assistance. Five minutes is a provisional time target, not a product guarantee. Report completed sessions over the five planned slots, successful attempts over all attempted sessions, and missing slots separately. A missing prerequisite counts in the real first-use journey; do not remove that attempt from the denominator.

Use the same tasks and comparable prerequisites for any before/after comparison. With five people, report the actual counts and observations instead of an estimated population conversion lift. AI agents and simulated novices do not count as participants. Without supplied sessions, human usability and time to first result remain Unproven.
