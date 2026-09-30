from __future__ import annotations

import hashlib
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from orbit_os.watchlist import load_watchlist
from orbitdiff.models import Account, Collection
from orbitdiff.store import GraphStore


def snapshot(names: dict[str, str], minute: int = 0) -> Collection:
    return Collection(
        target="atlas_studio", reported_count=len(names), complete=True,
        accounts=tuple(Account(profile_id=key, username=value) for key, value in names.items()),
        collected_at=datetime.now(UTC) - timedelta(minutes=10 - minute),
    )


def fingerprints(directory: Path) -> dict[str, tuple[str, int, int, int]]:
    return {
        path.name: (
            hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_size,
            path.stat().st_mtime_ns, path.stat().st_ctime_ns,
        )
        for path in directory.iterdir() if path.is_file()
    }


def test_missing_watchlist_stays_missing(tmp_path: Path) -> None:
    database = tmp_path / "unused" / "orbitdiff.sqlite3"
    assert load_watchlist(database) == []
    assert not database.parent.exists()


def test_watchlist_keeps_observed_pending_and_confirmed_evidence_separate(tmp_path: Path) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    store = GraphStore(database)
    store.apply_collection(snapshot({"1": "pixel_forge"}))
    store.apply_collection(snapshot({"2": "nova_labs"}, 1))

    watch = load_watchlist(database)[0]
    assert watch["username"] == "atlas_studio"
    assert watch["status"] == "ok"
    assert watch["following_count"] == 1
    assert watch["pending_count"] == 1
    assert watch["pending_removals"] == 1
    assert [(row["username"], row["status"]) for row in watch["accounts"]] == [("nova_labs", "pending")]
    assert watch["events"] == []

    store.apply_collection(snapshot({"2": "nova_labs"}, 2))
    watch = load_watchlist(database)[0]
    assert watch["accounts"][0]["status"] == "observed"
    assert {row["type"] for row in watch["events"]} == {"following_started", "following_stopped"}
    assert all(row["source"] == "watcher_confirmed" for row in watch["events"])
    assert watch["history"][0]["confirmed_removed_count"] == 1
    assert watch["history"][0]["confirmed_new_count"] == 1


def test_watchlist_normalizes_known_sqlite_utc_failure_date_and_retains_roster(tmp_path: Path) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    store = GraphStore(database)
    store.apply_collection(snapshot({"1": "pixel_forge"}))
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO runs(target, state, run_kind, collected_at, error) VALUES (?, ?, ?, ?, ?)",
            ("atlas_studio", "failed", "scan", "2026-09-30 00:00:00", "raw private diagnostics"),
        )
        connection.execute("DROP TABLE IF EXISTS live_attempts")
    before = fingerprints(tmp_path)

    watch = load_watchlist(database)[0]

    assert watch["status"] == "failed"
    assert watch["last_attempt_at"] == "2026-09-30T00:00:00+00:00"
    assert watch["last_run_at"] is not None
    assert watch["following_count"] == 1
    assert watch["accounts"][0]["username"] == "pixel_forge"
    assert "raw private diagnostics" not in repr(watch)
    assert fingerprints(tmp_path) == before


def test_watchlist_reads_committed_wal_without_changing_source_files(tmp_path: Path) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    store = GraphStore(database)
    store.initialize()
    keeper = sqlite3.connect(database)
    keeper.execute("PRAGMA wal_autocheckpoint=0")
    keeper.execute("SELECT * FROM targets").fetchall()
    try:
        store.apply_collection(snapshot({"1": "pixel_forge"}))
        assert database.with_name(database.name + "-wal").exists()
        before = fingerprints(tmp_path)
        assert load_watchlist(database)[0]["following_count"] == 1
        assert fingerprints(tmp_path) == before
    finally:
        keeper.close()


def test_unreadable_and_linked_sources_are_explicit_errors(tmp_path: Path) -> None:
    database = tmp_path / "invalid.sqlite3"
    database.write_bytes(b"not a database")
    before = fingerprints(tmp_path)
    with pytest.raises((OSError, ValueError, sqlite3.Error)):
        load_watchlist(database)
    assert fingerprints(tmp_path) == before
    linked = tmp_path / "linked.sqlite3"
    linked.symlink_to(database)
    with pytest.raises((OSError, ValueError)):
        load_watchlist(linked)


def test_naive_success_timestamp_is_not_assumed_to_be_sqlite_utc(tmp_path: Path) -> None:
    database = tmp_path / "orbitdiff.sqlite3"
    store = GraphStore(database)
    store.apply_collection(snapshot({"1": "pixel_forge"}))
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE runs SET collected_at = '2026-09-30 00:00:00'")

    watch = load_watchlist(database)[0]

    assert watch["last_run_at"] is None
    assert watch["last_attempt_at"] is None
    assert watch["status"] == "degraded"
    assert watch["stale"] is True
    assert watch["history"] == []
