# Walkthrough transcript

Original synthetic illustration, 28 seconds. These fixed dates are fictional; this is not a recording of live collection. The CLI's separate demo uses nova_labs and ember_lab, with variable timestamps.

| Time | On screen | Spoken / accessible text |
|---|---|---|
| 0-7 seconds | Who did they follow? Baseline: atlas_studio, September 30, 09:00 UTC | "A public following list. First check: a starting point, with no new-follow event." |
| 7-14 seconds | Pending: pixel_forge, first observed October 1, 09:00 UTC | "One observation sees pixel_forge. It is pending." |
| 14-21 seconds | Confirmed: first observed October 1; confirmed October 2, 09:00 UTC | "Another accepted complete observation agrees on the addition. These are observation dates, not exact Follow action times." |
| 21-28 seconds | Gap: October 3 incomplete. October 2 evidence retained | "An incomplete check leaves a gap, not a new conclusion. Try the offline demo with your agent." |

Requirements: Python 3.11+, Git, pipx, terminal access. Demo needs no login. v0.1.1 preview has no built-in daily alerts. Accepted complete uses provider-finished validation including >=95% reported-count coverage; exact roster completeness is not guaranteed.

The [HTML prototype](walkthrough.html) supports replay, a static transcript and reduced motion. [Creative scripts](creative-pack.md) reuse this story. [Message cards](message-cards.md) change only the hook.
