from __future__ import annotations

from orbitdiff.diff import EdgeState, reconcile


def test_reconcile_marks_first_changed_observation_pending() -> None:
    decision = reconcile(EdgeState(confirmed_present=True), observed_present=False)

    assert decision.kind == "pending"
    assert decision.present is False


def test_reconcile_confirms_matching_pending_observation() -> None:
    decision = reconcile(
        EdgeState(confirmed_present=True, pending_present=False), observed_present=False
    )

    assert decision.kind == "confirm"
    assert decision.present is False
    assert decision.event_type == "following_stopped"


def test_reconcile_clears_a_contradicted_pending_observation() -> None:
    decision = reconcile(
        EdgeState(confirmed_present=True, pending_present=False), observed_present=True
    )

    assert decision.kind == "clear"
