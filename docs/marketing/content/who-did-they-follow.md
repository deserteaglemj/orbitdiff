# Who did they follow?

OrbitDiff can identify accounts newly appearing in a public Instagram following list relative to its baseline. It confirms a change when two accepted complete observations agree on that relationship. It does not explain the person's intention.

**Synthetic example:** atlas_studio's baseline is September 30. pixel_forge first appears October 1, pending. Another accepted complete observation on October 2 agrees on the addition. The stored event is a confirmed following_started change, with those observation dates.

The current list alone is not an earlier list. OrbitDiff's history starts when you create the baseline; it cannot recreate follows from before that point. Brief changes between checks can be missed.

Accepted complete in v0.1.1 means provider-finished and validated, including >=95% of reported count, not guaranteed exhaustive coverage. An incomplete check preserves relationships and leaves a gap. A handle reveals neither identity nor gender, attraction, fidelity or motive.

**Try the offline demo with your agent:** use the [setup prompt](../../prompt.md). Python 3.11+, Git, pipx and terminal access are prerequisites. The demo uses fictional accounts without Instagram login. Live use requires a separate opt-in and a human-created local session.

Wondering about dates? Read [When did they follow that account?](observation-times.md). To inspect stored results, use [the agent history guide](agent-history.md). This selected v0.1.1 preview has no built-in daily alerts; see [release claims](../claim-ledger.md).
