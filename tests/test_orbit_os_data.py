from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from orbit_os import data as orbit_data
from orbit_os.data import load_state


def timestamp(hours: int = 0) -> str:
    return (datetime.now(UTC) - timedelta(hours=hours)).isoformat(timespec="seconds")


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def personal_database(home: Path, username: str = "atlas_studio") -> Path:
    path = home / "artifacts" / "instagram-personal-graph" / username / "graph.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE runs (
                id INTEGER PRIMARY KEY, mode TEXT, status TEXT, started_at TEXT,
                finished_at TEXT, follower_count INTEGER, following_count INTEGER,
                coverage TEXT, error_kind TEXT
            );
            CREATE TABLE accounts (
                pk TEXT PRIMARY KEY, username TEXT, full_name TEXT,
                is_private INTEGER, is_verified INTEGER, updated_at TEXT
            );
            CREATE TABLE edges (
                account_pk TEXT, edge_name TEXT, value INTEGER, confirmed INTEGER,
                pending INTEGER, pending_count INTEGER, updated_at TEXT
            );
            CREATE TABLE events (
                id INTEGER PRIMARY KEY, event_key TEXT, event_type TEXT,
                account_pk TEXT, details_json TEXT, observed_at TEXT
            );
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
            """
        )
        connection.execute(
            "INSERT INTO runs VALUES (1, 'daily', 'ok', ?, ?, 120, 4, ?, NULL)",
            (timestamp(2), timestamp(2), "following exact; inbound coverage bounded"),
        )
        for pk, username, followed_by, confirmed in [
            ("101", "nova_labs", 1, 1),
            ("102", "pixel_forge", 0, 1),
            ("103", "lunar_arch", 0, 0),
        ]:
            connection.execute(
                "INSERT INTO accounts VALUES (?, ?, ?, 0, 0, ?)",
                (pk, username, username.replace("_", " "), timestamp(2)),
            )
            connection.execute(
                "INSERT INTO edges VALUES (?, 'following', 1, 1, NULL, 0, ?)",
                (pk, timestamp(2)),
            )
            connection.execute(
                "INSERT INTO edges VALUES (?, 'followed_by', ?, ?, NULL, 0, ?)",
                (pk, followed_by, confirmed, timestamp(2)),
            )
        connection.execute("INSERT INTO meta VALUES ('unattributed_follower_balance', '-3')")
    return path


def watcher_path(home: Path, username: str = "nova_labs") -> Path:
    return home / "artifacts" / "ig-following-watch" / username / "state.json"


def watcher_state() -> dict[str, Any]:
    return {
        "schema": 2,
        "last_run_utc": timestamp(1),
        "last_pull": {
            "201": {"username": "pixel_forge", "full_name": "Pixel Forge"},
            "202": {"username": "lunar_arch", "full_name": "Lunar Arch"},
        },
        "pending": {"202": {"username": "lunar_arch"}},
        "pending_gone": {"203": {"username": "sunset_field"}},
        "history": [
            {"ts": timestamp(25), "event": "baseline", "following_count": 3},
            {
                "ts": timestamp(1),
                "event": "diff",
                "following_count": 2,
                "confirmed_new": ["pixel_forge"],
                "confirmed_unfollows": ["sunset_field"],
                "pending_count": 1,
                "gone_raw": 19,
            },
        ],
    }


def test_missing_sources_are_unavailable_and_not_zero(tmp_path: Path) -> None:
    result = load_state(tmp_path)
    assert result["schema_version"] == 1
    assert result["personal"]["status"] == "missing"
    assert result["personal"]["metrics"]["followers"] is None
    assert result["personal"]["metrics"]["following_observed"] is None
    assert result["watchlist"] == []
    assert result["schedules"] == []
    assert not (tmp_path / "artifacts").exists()


def test_personal_edges_require_confirmation_and_keep_unknown_distinct(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    before = hashlib.sha256(database.read_bytes()).hexdigest()
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "ok"
    assert personal["metrics"] == {
        "followers": 120,
        "following": 4,
        "mutuals": 1,
        "not_following_back": 1,
        "followers_observed": 1,
        "following_observed": 3,
        "reciprocal_unknown": 1,
        "unattributed_balance": -3,
    }
    accounts = {row["username"]: row for row in personal["accounts"]}
    assert accounts["nova_labs"]["relationship"] == "mutual"
    assert accounts["pixel_forge"]["relationship"] == "not_following_back"
    assert accounts["lunar_arch"]["relationship"] == "unknown"
    assert accounts["lunar_arch"]["followed_by"] is None
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before
    assert set(p.name for p in database.parent.iterdir()) == {"graph.db"}


def test_failed_attempt_retains_latest_good_counts(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO runs VALUES (2, 'daily', 'failed', ?, ?, NULL, NULL, NULL, ?)",
            (timestamp(), timestamp(), "private session material"),
        )
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "failed"
    assert personal["metrics"]["followers"] == 120
    assert personal["last_success_at"] != personal["last_attempt_at"]
    assert personal["runs"][0]["error_kind"] == "collection_error"
    assert "private session material" not in json.dumps(personal)


def test_personal_events_filter_types_sources_timestamps_and_count_identity(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    with sqlite3.connect(database) as connection:
        for row in [
            (1, "e1", "unknown_inbound_delta", "101", '{"delta":-2,"source":"activity","cookie":"secret"}', timestamp()),
            (2, "e2", "follower_started", "101", '{"source":"activity","headers":"secret"}', timestamp()),
            (3, "e3", "arbitrary_event", "101", "{}", timestamp()),
            (4, "e4", "following_started", "101", "{}", "<script>bad</script>"),
        ]:
            connection.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)", row)
    events = load_state(tmp_path)["personal"]["events"]
    assert len(events) == 2
    count_event = next(event for event in events if event["type"] == "unknown_inbound_delta")
    assert count_event["username"] is None
    assert count_event["full_name"] is None
    assert count_event["delta"] == -2
    named_event = next(event for event in events if event["type"] == "follower_started")
    assert named_event["source"] == "activity"
    assert "secret" not in json.dumps(events)


def test_invalid_usernames_are_not_rendered_or_used_as_paths(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE accounts SET username = ? WHERE pk = '101'", ("nova_labs\n",))
    write_json(watcher_path(tmp_path, "invalid-target"), watcher_state())
    result = load_state(tmp_path)
    assert result["watchlist"] == []
    account = next(row for row in result["personal"]["accounts"] if row["id"] == "101")
    assert account["username"] is None


def test_multiple_personal_databases_are_ambiguous(tmp_path: Path) -> None:
    personal_database(tmp_path)
    personal_database(tmp_path, "pixel_forge")
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "error"
    assert personal["username"] is None
    assert personal["metrics"]["followers"] is None
    assert personal["issues"][0]["code"] == "personal_ambiguous"


def test_obsolete_graph_is_never_used(tmp_path: Path) -> None:
    obsolete = tmp_path / "artifacts" / "social-follow-graph" / "graph.db"
    obsolete.parent.mkdir(parents=True)
    obsolete.write_bytes(b"not a database")
    assert load_state(tmp_path)["personal"]["status"] == "missing"


def test_watched_roster_is_observed_and_unfollows_are_confirmed_only(tmp_path: Path) -> None:
    write_json(watcher_path(tmp_path), watcher_state())
    watch = load_state(tmp_path)["watchlist"][0]
    assert watch["following_count"] == 2
    assert watch["pending_count"] == 1
    assert watch["pending_removals"] == 1
    assert {row["status"] for row in watch["accounts"]} == {"observed", "pending"}
    assert [event["type"] for event in watch["events"]].count("following_stopped") == 1
    assert watch["history"][0]["confirmed_removed_count"] == 1
    assert all("gone_raw" not in event for event in watch["events"])


def test_hidden_watcher_without_state_has_no_false_zero(tmp_path: Path) -> None:
    marker = watcher_path(tmp_path).with_name("list_visibility.json")
    write_json(marker, {"following": "hidden", "followers": "hidden", "checked_at": timestamp()})
    watch = load_state(tmp_path)["watchlist"][0]
    assert watch["status"] == "hidden"
    assert watch["visibility"] == "hidden"
    assert watch["following_count"] is None
    assert watch["pending_count"] is None
    assert watch["accounts"] == []


def test_bad_source_is_isolated_and_does_not_expose_raw_content(tmp_path: Path) -> None:
    personal_database(tmp_path)
    corrupt = watcher_path(tmp_path)
    corrupt.parent.mkdir(parents=True)
    corrupt.write_text("credential-shaped confidential material", encoding="utf-8")
    write_json(watcher_path(tmp_path, "pixel_forge"), watcher_state())
    result = load_state(tmp_path)
    assert result["personal"]["status"] == "ok"
    statuses = {watch["username"]: watch["status"] for watch in result["watchlist"]}
    assert statuses == {"nova_labs": "error", "pixel_forge": "ok"}
    assert "confidential material" not in json.dumps(result)
    assert str(tmp_path) not in json.dumps(result)


def test_stale_and_malformed_timestamps_cannot_look_healthy(tmp_path: Path) -> None:
    state = watcher_state()
    state["last_run_utc"] = timestamp(40)
    write_json(watcher_path(tmp_path), state)
    stale = load_state(tmp_path)["watchlist"][0]
    assert stale["stale"] is True
    assert stale["status"] == "stale"
    state["last_run_utc"] = "2026-01-01<script>"
    write_json(watcher_path(tmp_path), state)
    malformed = load_state(tmp_path)["watchlist"][0]
    assert malformed["last_run_at"] is None
    assert malformed["status"] == "degraded"


def test_schedule_projection_excludes_unrelated_and_sensitive_fields(tmp_path: Path) -> None:
    write_json(watcher_path(tmp_path), watcher_state())
    write_json(
        tmp_path / "cron" / "jobs.json",
        {
            "jobs": [
                {"id": "job1", "name": "personal", "script": "ig_personal_graph_watch.py", "enabled": True,
                 "schedule": {"kind": "cron", "expr": "0 9 * * *", "display": "untrusted"},
                 "last_run_at": timestamp(), "next_run_at": timestamp(-24), "last_status": "ok", "prompt": "secret"},
                {"id": "job2", "script": "ig_following_watch_nova_labs.py", "enabled": False, "schedule": {"kind": "cron", "expr": "35 9 * * *"}},
                {"id": "job3", "script": "unrelated.py", "prompt": "secret"},
                {"id": "job4", "script": "ig_following_watch_unknown_target.py"},
            ]
        },
    )
    result = load_state(tmp_path)
    assert [job["id"] for job in result["schedules"]] == ["job1", "job2"]
    assert result["schedules"][0]["schedule"] == "0 9 * * *"
    assert result["schedules"][1]["enabled"] is False
    assert "secret" not in json.dumps(result["schedules"])
    assert "prompt" not in json.dumps(result["schedules"])


def test_symlink_source_is_not_followed(tmp_path: Path) -> None:
    actual = tmp_path / "outside"
    personal_database(actual)
    linked = tmp_path / "inside" / "artifacts" / "instagram-personal-graph"
    linked.parent.mkdir(parents=True)
    linked.symlink_to(actual / "artifacts" / "instagram-personal-graph", target_is_directory=True)
    personal = load_state(tmp_path / "inside")["personal"]
    assert personal["status"] == "error"
    assert personal["metrics"]["followers"] is None


def test_newer_cron_failure_sets_latest_attempt_and_safe_recovery(tmp_path: Path) -> None:
    personal_database(tmp_path)
    attempted = timestamp()
    write_json(
        tmp_path / "cron" / "jobs.json",
        {"jobs": [{
            "id": "job1", "script": "ig_personal_graph_watch.py", "enabled": True,
            "last_run_at": attempted, "last_status": "error",
            "last_error": "Request failed with HTTP 429; sensitive local diagnostics",
        }]},
    )
    result = load_state(tmp_path)
    assert result["personal"]["last_attempt_at"] == attempted
    assert result["personal"]["status"] == "failed"
    assert result["personal"]["metrics"]["followers"] == 120
    assert result["schedules"][0]["error_kind"] == "rate_limited"
    assert result["schedules"][0]["recovery"]
    assert any(issue["code"] == "rate_limited" for issue in result["personal"]["issues"])
    assert "sensitive local diagnostics" not in json.dumps(result)


def test_older_cron_failure_does_not_override_new_success(tmp_path: Path) -> None:
    personal_database(tmp_path)
    write_json(
        tmp_path / "cron" / "jobs.json",
        {"jobs": [{
            "id": "job1", "script": "ig_personal_graph_watch.py", "last_run_at": timestamp(48),
            "last_status": "error", "last_error": "ModuleNotFoundError",
        }]},
    )
    result = load_state(tmp_path)
    assert result["personal"]["status"] == "ok"
    assert result["schedules"][0]["error_kind"] == "dependency_missing"


def test_zero_counts_and_degraded_success_remain_valid(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE runs SET status='degraded', follower_count=0, following_count=0")
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "degraded"
    assert personal["metrics"]["followers"] == 0
    assert personal["metrics"]["following"] == 0
    state = watcher_state()
    state["last_pull"] = {}
    write_json(watcher_path(tmp_path), state)
    assert load_state(tmp_path)["watchlist"][0]["following_count"] == 0


def test_arbitrary_coverage_and_invalid_details_types_are_dropped(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE runs SET coverage='private raw headers'")
        connection.execute(
            "INSERT INTO events VALUES (1, 'e1', 'following_started', '101', ?, ?)",
            ('{"source":["unexpected"],"delta":true,"field":"private raw headers"}', timestamp()),
        )
    personal = load_state(tmp_path)["personal"]
    assert personal["coverage"] is None
    assert personal["events"][0]["source"] is None
    assert personal["events"][0]["delta"] is None
    assert "private raw headers" not in json.dumps(personal)


def test_public_names_remove_control_characters(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    supplied = "Nova\x00 Labs\n" + chr(8238) + "Studio" + chr(8212) + "Local"
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE accounts SET full_name = ? WHERE pk = '101'", (supplied,))
    personal = load_state(tmp_path)["personal"]
    account = next(row for row in personal["accounts"] if row["id"] == "101")
    assert account["full_name"] == "Nova Labs Studio-Local"


def directory_bytes(path: Path) -> dict[str, bytes]:
    return {item.name: item.read_bytes() for item in path.iterdir() if item.is_file()}


def test_wal_database_without_sidecars_leaves_source_directory_unchanged(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.close()
    before = directory_bytes(database.parent)
    assert set(before) == {"graph.db"}
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "ok"
    assert directory_bytes(database.parent) == before


def test_committed_wal_rows_are_visible_without_changing_source_files(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    connection = sqlite3.connect(database)
    try:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA wal_autocheckpoint = 0")
        connection.execute("UPDATE runs SET follower_count = 127")
        connection.commit()
        before = directory_bytes(database.parent)
        assert before["graph.db-wal"]
        personal = load_state(tmp_path)["personal"]
        assert personal["metrics"]["followers"] == 127
        assert directory_bytes(database.parent) == before
    finally:
        connection.close()


def test_continuously_changing_database_rejects_snapshot_after_bounded_retries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = personal_database(tmp_path)
    original_copy = orbit_data._copy_source_file
    attempts = 0

    def changing_copy(source: Path, destination: Path, version: Any) -> None:
        nonlocal attempts
        original_copy(source, destination, version)
        if source == database:
            attempts += 1
            connection = sqlite3.connect(source)
            try:
                connection.execute("UPDATE runs SET follower_count = follower_count + 1")
                connection.commit()
            finally:
                connection.close()

    monkeypatch.setattr(orbit_data, "_copy_source_file", changing_copy)
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "error"
    assert personal["metrics"]["followers"] is None
    assert attempts == 3
    assert set(directory_bytes(database.parent)) == {"graph.db"}


def test_wal_symlink_is_rejected_without_reading_target(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    elsewhere = tmp_path / "unrelated.txt"
    elsewhere.write_text("must remain unread", encoding="utf-8")
    database.with_name("graph.db-wal").symlink_to(elsewhere)
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "error"
    assert personal["metrics"]["followers"] is None


def test_source_changed_once_is_retried_and_latest_state_is_visible(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = personal_database(tmp_path)
    original_copy = orbit_data._copy_source_file
    attempts = 0

    def changing_copy(source: Path, destination: Path, version: Any) -> None:
        nonlocal attempts
        original_copy(source, destination, version)
        if source == database:
            attempts += 1
            if attempts == 1:
                connection = sqlite3.connect(source)
                try:
                    connection.execute("UPDATE runs SET follower_count = 128")
                    connection.commit()
                finally:
                    connection.close()

    monkeypatch.setattr(orbit_data, "_copy_source_file", changing_copy)
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "ok"
    assert personal["metrics"]["followers"] == 128
    assert attempts == 2


def test_snapshot_is_private_and_disappears_after_read(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    with orbit_data._snapshot_connection(tmp_path, database) as connection:
        location = Path(connection.execute("PRAGMA database_list").fetchone()[2])
        assert location != database
        assert location.parent.stat().st_mode & 0o777 == 0o700
        assert location.stat().st_mode & 0o777 == 0o600
        assert connection.execute("SELECT follower_count FROM runs").fetchone()[0] == 120
    assert not location.parent.exists()


def test_source_symlink_appearing_during_copy_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = personal_database(tmp_path)
    original_copy = orbit_data._copy_source_file

    def changing_copy(source: Path, destination: Path, version: Any) -> None:
        original_copy(source, destination, version)
        if source == database:
            moved = database.with_name("original.db")
            database.rename(moved)
            database.symlink_to(moved)

    monkeypatch.setattr(orbit_data, "_copy_source_file", changing_copy)
    personal = load_state(tmp_path)["personal"]
    assert personal["status"] == "error"
    assert personal["metrics"]["followers"] is None


def test_active_rollback_transaction_is_not_presented_as_committed(tmp_path: Path) -> None:
    database = personal_database(tmp_path)
    connection = sqlite3.connect(database)
    try:
        connection.execute("UPDATE runs SET follower_count = 128")
        assert database.with_name("graph.db-journal").exists()
        personal = load_state(tmp_path)["personal"]
        assert personal["status"] == "error"
        assert personal["metrics"]["followers"] is None
    finally:
        connection.rollback()
        connection.close()


@pytest.mark.parametrize(
    ("cron_hours", "active_error"), [(0, "rate_limited"), (3, "dependency_missing")],
)
def test_current_collector_error_follows_latest_attempt_chronology(
    tmp_path: Path, cron_hours: int, active_error: str,
) -> None:
    database = personal_database(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO runs VALUES (2, 'daily', 'failed', ?, ?, NULL, NULL, NULL, ?)",
            (timestamp(1), timestamp(1), "ModuleNotFoundError"),
        )
    write_json(
        tmp_path / "cron" / "jobs.json",
        {"jobs": [{
            "id": "job1", "script": "ig_personal_graph_watch.py", "enabled": True,
            "last_run_at": timestamp(cron_hours), "last_status": "error", "last_error": "HTTP 429",
        }]},
    )
    personal = load_state(tmp_path)["personal"]
    assert [issue["code"] for issue in personal["issues"]] == [active_error]
    assert personal["runs"][0]["error_kind"] == "dependency_missing"
    assert personal["metrics"]["followers"] == 120


def test_new_collector_error_preserves_unrelated_active_issues() -> None:
    issues = [
        {"code": "coverage_degraded", "message": "Coverage remains partial."},
        {"code": "personal_stale", "message": "Last successful snapshot is stale."},
        {"code": "source_warning", "message": "The source needs attention."},
    ]
    personal: dict[str, Any] = {
        "last_attempt_at": timestamp(1), "status": "failed",
        "issues": [{"code": "dependency_missing", "message": "Old recovery advice."}, *issues],
    }
    orbit_data._attach_personal_schedule(personal, [{
        "script": "ig_personal_graph_watch.py", "last_run_at": timestamp(),
        "last_status": "error", "error_kind": "rate_limited",
    }])
    assert personal["issues"][:3] == issues
    assert [issue["code"] for issue in personal["issues"]] == [
        "coverage_degraded", "personal_stale", "source_warning", "rate_limited",
    ]
