from __future__ import annotations

import hashlib
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier

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


def test_repeated_baseline_cannot_confirm_a_pending_removal(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}), baseline_run=True)
    store.apply_collection(collection("atlas_studio", {}, 1))
    assert store.apply_collection(collection("atlas_studio", {}, 2), baseline_run=True) == []
    assert store.events("atlas_studio") == []
    assert store.status("atlas_studio")["confirmed_count"] == 1
    assert store.status("atlas_studio")["pending_count"] == 1


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


def test_live_attempt_reservation_covers_baseline_failure_and_exact_cooldown(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    now = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}), baseline_run=True)

    assert not store.reserve_live_attempt("atlas_studio", now=now + timedelta(minutes=29))
    assert store.reserve_live_attempt("atlas_studio", now=now + timedelta(minutes=30))
    store.record_failed_run("atlas_studio", "collection incomplete")
    assert not store.reserve_live_attempt("atlas_studio", now=now + timedelta(minutes=31))
    assert store.status("atlas_studio")["confirmed_count"] == 1
    assert store.status("atlas_studio")["pending_count"] == 0


def test_live_attempt_is_committed_before_another_store_can_reserve(tmp_path: Path) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    GraphStore(database).initialize()
    gate = Barrier(2)
    now = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)

    def reserve() -> bool:
        gate.wait(timeout=5)
        return GraphStore(database).reserve_live_attempt("atlas_studio", now=now)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _index: reserve(), range(2)))

    assert sorted(results) == [False, True]
    assert GraphStore(database).status("atlas_studio")["confirmed_count"] is None
    assert GraphStore(database).status("atlas_studio")["observation_status"] == "pending"


def test_legacy_sqlite_failure_timestamp_enforces_cooldown(tmp_path: Path) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    store = GraphStore(database)
    store.initialize()
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TABLE IF EXISTS live_attempts")
        connection.execute(
            "INSERT INTO runs(target, state, run_kind, collected_at, error) VALUES (?, ?, ?, ?, ?)",
            ("atlas_studio", "failed", "scan", "2026-09-11 12:00:00", "collection incomplete"),
        )

    assert not store.reserve_live_attempt("atlas_studio", now=datetime(2026, 9, 11, 12, 29, tzinfo=UTC))
    assert store.reserve_live_attempt("atlas_studio", now=datetime(2026, 9, 11, 12, 30, tzinfo=UTC))
    assert store.status("atlas_studio")["failed_runs"] == 1


def test_target_discovery_and_roster_preserve_pending_removal(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}), baseline_run=True)
    store.apply_collection(collection("atlas_studio", {"2": "nova_labs"}, 1))

    targets = store.targets()
    assert [row["target"] for row in targets] == ["atlas_studio"]
    assert targets[0]["confirmed_count"] == 1
    assert targets[0]["pending_count"] == 2
    rows = {row["profile_id"]: row for row in store.roster("atlas_studio")}
    assert rows["1"]["confirmed_present"] is True
    assert rows["1"]["observed_present"] is False
    assert rows["1"]["pending_present"] is False
    assert rows["2"]["confirmed_present"] is False
    assert rows["2"]["observed_present"] is True
    assert rows["2"]["pending_present"] is True


def test_discovery_does_not_create_missing_database(tmp_path: Path) -> None:
    database = tmp_path / "unused" / "orbitdiff.sqlite3"
    store = GraphStore(database)

    assert store.targets() == []
    assert store.roster("atlas_studio") == []
    assert not database.parent.exists()


def test_discovery_and_roster_do_not_migrate_legacy_source(tmp_path: Path) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    store = GraphStore(database)
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}))
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TABLE IF EXISTS live_attempts")

    def fingerprint() -> dict[str, tuple[str, int, int]]:
        return {
            path.name: (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns, path.stat().st_ctime_ns)
            for path in tmp_path.iterdir() if path.is_file()
        }

    before = fingerprint()
    assert store.targets()[0]["target"] == "atlas_studio"
    assert store.roster("atlas_studio")[0]["username"] == "pixel_forge"
    assert fingerprint() == before


def test_all_graph_reads_leave_missing_storage_uncreated(tmp_path: Path) -> None:
    database = tmp_path / "unused" / "orbitdiff.sqlite3"
    store = GraphStore(database)

    state = store.status("atlas_studio")
    assert state["initialized"] is False
    assert state["observation_status"] == "missing"
    assert state["confirmed_count"] is None
    assert state["pending_count"] is None
    assert store.events("atlas_studio") == []
    assert store.last_live_scan_at("atlas_studio") is None
    assert not database.parent.exists()


def test_failed_only_target_keeps_relationship_counts_unknown(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    store.record_failed_run("atlas_studio", "collection incomplete", baseline_run=True)

    state = store.status("atlas_studio")
    assert state["initialized"] is False
    assert state["observation_status"] == "failed"
    assert state["confirmed_count"] is None
    assert state["pending_count"] is None
    assert state["failed_runs"] == 1
    assert state["last_success_at"] is None
    assert store.targets() == [state]


def test_complete_empty_baseline_is_known_zero(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    store.apply_collection(collection("atlas_studio", {}), baseline_run=True)
    state = store.status("atlas_studio")
    assert state["initialized"] is True
    assert state["observation_status"] == "observed"
    assert state["confirmed_count"] == 0
    assert state["pending_count"] == 0
    assert state["last_success_at"] is not None


def test_status_events_and_last_scan_do_not_modify_legacy_source(tmp_path: Path) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    store = GraphStore(database)
    store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}))
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TABLE IF EXISTS live_attempts")

    def fingerprint() -> dict[str, tuple[str, int, int, int]]:
        return {
            path.name: (
                hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns,
                path.stat().st_ctime_ns, path.stat().st_mode,
            )
            for path in tmp_path.iterdir() if path.is_file()
        }

    before = fingerprint()
    assert store.status("atlas_studio")["confirmed_count"] == 1
    assert store.events("atlas_studio") == []
    assert store.last_live_scan_at("atlas_studio") is not None
    assert fingerprint() == before


@pytest.mark.parametrize("action", ["initialize", "reserve", "apply", "failure"])
def test_writers_reject_linked_database_without_modifying_external_source(tmp_path: Path, action: str) -> None:
    external = tmp_path / "external.sqlite3"
    with sqlite3.connect(external) as connection:
        connection.execute("CREATE TABLE sentinel(value TEXT)")
        connection.execute("INSERT INTO sentinel VALUES ('unchanged')")
    external.chmod(0o644)
    directory = tmp_path / "workspace"
    directory.mkdir(mode=0o755)
    database = directory / "orbitdiff.sqlite3"
    database.symlink_to(external)
    before = external.read_bytes(), external.stat().st_mode, directory.stat().st_mode
    store = GraphStore(database)
    with pytest.raises(OSError, match="link"):
        if action == "initialize":
            store.initialize()
        elif action == "reserve":
            store.reserve_live_attempt("atlas_studio")
        elif action == "apply":
            store.apply_collection(collection("atlas_studio", {"1": "pixel_forge"}))
        else:
            store.record_failed_run("atlas_studio", "collection incomplete")
    assert before == (external.read_bytes(), external.stat().st_mode, directory.stat().st_mode)


@pytest.mark.parametrize("suffix", ["-wal", "-shm", "-journal"])
def test_writers_reject_linked_sidecars_before_chmod_or_open(tmp_path: Path, suffix: str) -> None:
    directory = tmp_path / "workspace"
    directory.mkdir(mode=0o755)
    database = directory / "orbitdiff.sqlite3"
    external = tmp_path / "outside.bin"
    external.write_bytes(b"outside content")
    database.with_name(database.name + suffix).symlink_to(external)
    before = external.read_bytes(), external.stat().st_mode, directory.stat().st_mode
    with pytest.raises(OSError, match="link"):
        GraphStore(database).reserve_live_attempt("atlas_studio")
    assert before == (external.read_bytes(), external.stat().st_mode, directory.stat().st_mode)
    assert not database.exists()


def test_linked_ancestor_is_rejected_for_graph_reads_and_writes(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir(mode=0o755)
    alias = tmp_path / "alias"
    alias.symlink_to(outside, target_is_directory=True)
    store = GraphStore(alias / "new" / "orbitdiff.sqlite3")
    with pytest.raises(OSError, match="link"):
        store.reserve_live_attempt("atlas_studio")
    with pytest.raises(OSError, match="link"):
        store.status("atlas_studio")
    assert not (outside / "new").exists()


def test_two_truncated_collections_cannot_confirm_false_removals(tmp_path: Path) -> None:
    store = GraphStore(tmp_path / "orbitdiff.sqlite3")
    baseline = {str(index): f"profile_{index}" for index in range(100)}
    store.apply_collection(collection("atlas_studio", baseline), baseline_run=True)
    before = store.roster("atlas_studio")
    for offset in (1, 2):
        truncated = Collection(
            target="atlas_studio", reported_count=100,
            accounts=tuple(Account(str(index), f"profile_{index}") for index in range(95)),
            complete=True, collected_at=datetime(2026, 9, 11, 12, offset, tzinfo=UTC),
        )
        with pytest.raises((ValueError, RuntimeError), match="reported|incomplete"):
            store.apply_collection(truncated)
    assert store.roster("atlas_studio") == before
    assert store.events("atlas_studio") == []
    assert store.status("atlas_studio")["confirmed_count"] == 100
    assert store.status("atlas_studio")["pending_count"] == 0
