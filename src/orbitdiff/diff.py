from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class EdgeState:
    confirmed_present: bool
    pending_present: bool | None = None


@dataclass(frozen=True)
class EdgeDecision:
    kind: Literal["none", "pending", "confirm", "clear"]
    present: bool | None = None
    event_type: Literal["following_started", "following_stopped"] | None = None


def reconcile(previous_edge: EdgeState, observed_present: bool) -> EdgeDecision:
    if previous_edge.pending_present is None:
        if observed_present == previous_edge.confirmed_present:
            return EdgeDecision("none")
        return EdgeDecision("pending", present=observed_present)

    if observed_present == previous_edge.confirmed_present:
        return EdgeDecision("clear")

    if observed_present == previous_edge.pending_present:
        event_type: Literal["following_started", "following_stopped"]
        event_type = "following_started" if observed_present else "following_stopped"
        return EdgeDecision("confirm", present=observed_present, event_type=event_type)

    return EdgeDecision("clear")
