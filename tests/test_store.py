from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from orbitdiff.models import Account, Collection
from orbitdiff.store import GraphStore


def collection(target: str, usernames: dict[str, str], minute: int = 0) -> Collection:
    return Collection(
        target=target,
        reported_count=len(usernames),
        accounts=tuple(Account(profile_id=key, username=value) for key, value in usernames.items()),
        complete=True,
        collected_at=datetime(2026, 9, 11, 12, minute, tzinfo=UTC),
    )


def test_initialization_uses_wal_foreign_keys_and_private_database_mode(tmp_path: Path) -> None:
    database = tmp_path / "state" / "orbitdiff.sqlite3"
    store = GraphStore(database)
    store.initialize()

    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert connection.execute("PRAGMA foreign_key_list(edges)").fetchall()

    assert database.stat().st_mode & 0o077 == 0


def test_baseline_is_silent_and_parameterized_account_data_is_preserved(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    account_name = "atlas'); DROP TABLE edges; --"

    events = store.apply_collection(collection("atlas_studio", {"1": account_name}))

    assert events == []
    assert store.status("atlas_studio")["confirmed_count"] == 1
    assert store.status("atlas_studio")["pending_count"] == 0
    with sqlite3.connect(tmp_path / "orbitdiff.sqlite3") as connection:
        assert connection.execute("SELECT username FROM accounts WHERE profile_id = ?", ("1",)).fetchone() == (account_name,)
        assert connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'edges'").fetchone() == ("edges",)


def test_first_change_is_pending_and_second_matching_scan_confirms(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}))

    assert store.apply_collection(collection("atlas_studio", {"2": "nova_labs"}, 1)) == []
    assert store.status("atlas_studio")["pending_count"] == 2

    events = store.apply_collection(collection("atlas_studio", {"2": "nova_labs"}, 2))

    assert {(event.event_type, event.actor_id) for event in events} == {
        ("following_started", "2"),
        ("following_stopped", "1"),
    }
    assert store.status("atlas_studio")["confirmed_count"] == 1
    assert store.status("atlas_studio")["pending_count"] == 0


def test_contradictory_observation_clears_pending_change(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    baseline = {"1": "pixel_forge"}
    store.apply_collection(collection("atlas_studio", baseline))
    store.apply_collection(collection("atlas_studio", {} , 1))

    assert store.status("atlas_studio")["pending_count"] == 1
    assert store.apply_collection(collection("atlas_studio", baseline, 2)) == []
    assert store.status("atlas_studio")["pending_count"] == 0
    assert store.events("atlas_studio") == []


def test_incomplete_collection_and_failed_run_do_not_mutate_graph_state(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}))
    incomplete = Collection(
        target="atlas_studio",
        reported_count=2,
        accounts=(Account(profile_id="2", username="nova_labs"),),
        complete=False,
        collected_at=datetime.now(UTC),
    )

    with pytest.raises(ValueError, match="incomplete"):
        store.apply_collection(incomplete)
    store.record_failed_run("atlas_studio", "collection incomplete")

    state = store.status("atlas_studio")
    assert state["confirmed_count"] == 1
    assert state["pending_count"] == 0
    assert state["failed_runs"] == 1


def test_transaction_rolls_back_when_observation_write_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}))

    def fail(*_args: object, **_kwargs: object) -> None:
        raise sqlite3.IntegrityError("forced rollback")

    monkeypatch.setattr(store, "_apply_observation", fail)
    with pytest.raises(sqlite3.IntegrityError, match="forced rollback"):
        store.apply_collection(collection("atlas_studio", {"2": "nova_labs"}, 1))

    assert store.status("atlas_studio")["confirmed_count"] == 1
    assert store.status("atlas_studio")["pending_count"] == 0


def test_repeated_follow_unfollow_follow_cycles_create_distinct_events(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}))
    store.apply_collection(collection("atlas_studio", {"2": "nova_labs"}, 1))
    store.apply_collection(collection("atlas_studio", {"2": "nova_labs"}, 2))
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}, 3))
    events = store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}, 4))

    assert {(event.event_type, event.actor_id) for event in events} == {
        ("following_started", "1"),
        ("following_stopped", "2"),
    }
    assert len(store.events("atlas_studio")) == 4
