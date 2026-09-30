# Orbit relationship context

Orbit OS and the OrbitDiff Agent Skill operate on personal export observations and public following-list observations. These sources have different completeness and confirmation rules.

## Language

**OrbitDiff Agent Skill**: Portable instructions for a local agent with file access and command execution. The separately installed runtime provides its commands.

**Orbit OS**: The local relationship application and shared workspace interface. Its standalone desktop distribution includes the runtime and can operate without an AI agent.

**Owner**: The account whose supplied personal exports populate a workspace. Ownership may be declared by the user; another owner needs another workspace.

**Public target**: An account whose publicly accessible following list is explicitly collected. It is separate from the human's login account and the personal-export owner.

**Personal export observation**: Relationship evidence from the owner's supplied export snapshot. Username-only exports cannot establish identity across renames. _Avoid_: live-confirmed personal follow.

**Capture time**: When the whole export snapshot was captured. Row timestamps, filesystem dates, and import time are not substitutes.

**Personal coverage**: Completeness declared by the user for a relationship direction. Effective complete coverage additionally requires the expected contiguous shards and known capture time; the declaration is not independently verified.

**Current snapshot**: The selected latest dated personal observation. An older or undated import cannot displace a newer dated snapshot.

**Mutual**: Observed presence in both personal relationship directions. Positive presence does not require complete coverage.

**Unknown reciprocity**: Insufficient evidence to establish absence in a relationship direction. Only effective complete coverage can make an absent account's relationship false.

**Public baseline**: The first complete public observation, accepted without generating change events.

**Pending public change**: A relationship differs from its confirmed state in one complete public observation. Pending removal can coexist with confirmed presence.

**Confirmed public following change**: The same relationship change appears in another complete public observation. Confirmation applies to the relationship edge; the entire rosters need not be identical.

**Failed attempt**: A collection attempt that does not replace the last good relationship evidence. A generic failure does not establish its cause.

**Read-only Instagram access**: Collection without account actions. Local imports, reports, and authorized collection can still write to the selected private workspace.
